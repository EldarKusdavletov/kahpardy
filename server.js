'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./src/game');
const { loadQuestions } = require('./src/questions');

const QUESTION_MS = 15000;
const BAG_INTRO_MS = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function createServer({ questionsFile, hostKey, questionMs = QUESTION_MS, bagIntroMs = BAG_INTRO_MS }) {
  const questions = loadQuestions(questionsFile, path.join(PUBLIC_DIR, 'img'));
  let game = new Game(questions, { questionMs });

  const app = express();
  app.get('/', (req, res) => res.redirect('/play'));
  app.get('/play', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'play.html')));
  app.get('/host', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));
  app.get('/qr.svg', async (req, res, next) => {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
      const svg = await QRCode.toString(`${proto}://${req.get('host')}/play`, { type: 'svg', margin: 1 });
      res.type('image/svg+xml').send(svg);
    } catch (err) {
      next(err);
    }
  });
  app.use(express.static(PUBLIC_DIR));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const playerSockets = new Map(); // playerId -> Set<socket>
  let timer = null;

  // Socket payloads come from untrusted clients: anything that is not an object becomes {}.
  const payload = (p) => (p && typeof p === 'object' ? p : {});

  function broadcast() {
    const serverNow = Date.now();
    io.to('host').emit('state', { ...game.hostView(), serverNow });
    for (const [playerId, sockets] of playerSockets) {
      const view = { ...game.playerView(playerId), serverNow };
      for (const s of sockets) s.emit('state', view);
    }
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function closeQuestion() {
    if (game.phase !== 'question') return; // never touch the bag-intro timer
    clearTimer();
    game.closeQuestion();
    broadcast();
  }

  function startQuestionTimer() {
    clearTimer();
    timer = setTimeout(closeQuestion, questionMs);
  }

  function reset() {
    if (game.phase !== 'final') return;
    clearTimer();
    game = new Game(questions, { questionMs });
    for (const sockets of playerSockets.values()) {
      for (const s of sockets) {
        s.data.playerId = null;
        s.emit('reset');
      }
    }
    playerSockets.clear();
    broadcast();
  }

  function setupHost(socket) {
    socket.join('host');
    socket.emit('state', { ...game.hostView(), serverNow: Date.now() });
    socket.on('start', () => { if (game.start()) broadcast(); });
    socket.on('open', (p) => {
      const { theme, value } = payload(p);
      if (!game.openCell(theme, value, Date.now())) return;
      if (game.phase === 'bag_intro') {
        clearTimer();
        timer = setTimeout(() => {
          timer = null;
          if (game.beginBagQuestion(Date.now())) {
            startQuestionTimer();
            broadcast();
          }
        }, bagIntroMs);
      } else {
        startQuestionTimer();
      }
      broadcast();
    });
    socket.on('close', closeQuestion);
    socket.on('board', () => { if (game.toBoard()) broadcast(); });
    socket.on('end', () => {
      if (!game.end()) return;
      clearTimer();
      broadcast();
    });
    socket.on('reset', reset);
  }

  function setupPlayer(socket) {
    socket.data.playerId = null;

    function detach() {
      const { playerId } = socket.data;
      const sockets = playerId && playerSockets.get(playerId);
      if (!sockets) return false;
      sockets.delete(socket);
      if (sockets.size > 0) return false;
      playerSockets.delete(playerId);
      game.disconnect(playerId);
      return true;
    }

    socket.on('join', (p, ack) => {
      const { name, token } = payload(p);
      const reply = typeof ack === 'function' ? ack : () => {};
      const current = socket.data.playerId && game.players.get(socket.data.playerId);
      if (current) {
        // One socket = one player: only re-confirm the same identity, never create another.
        if (token === current.token) reply({ ok: true, playerId: current.id, token: current.token, name: current.name });
        else reply({ ok: false, error: 'Уже в игре / Already joined' });
        return;
      }
      let player;
      try {
        player = game.join(name, token);
      } catch (err) {
        reply({ ok: false, error: err.message });
        return;
      }
      socket.data.playerId = player.id;
      if (!playerSockets.has(player.id)) playerSockets.set(player.id, new Set());
      playerSockets.get(player.id).add(socket);
      reply({ ok: true, playerId: player.id, token: player.token, name: player.name });
      broadcast();
    });

    socket.on('answer', (p) => {
      const { option } = payload(p);
      const { playerId } = socket.data;
      if (!playerId || !game.answer(playerId, option, Date.now())) return;
      if (game.allAnswered()) closeQuestion();
      else broadcast();
    });

    socket.on('disconnect', () => {
      if (!detach()) return;
      if (game.allAnswered()) closeQuestion();
      else broadcast();
    });
  }

  io.on('connection', (socket) => {
    const { role, key } = socket.handshake.auth || {};
    if (role === 'host') {
      if (key !== hostKey) {
        socket.emit('auth_error');
        socket.disconnect(true);
        return;
      }
      setupHost(socket);
    } else {
      setupPlayer(socket);
    }
  });

  return { app, httpServer, io, get game() { return game; } };
}

// QUESTIONS_FILE env → ./questions.json → Render secret file. The real questions are not in git.
function resolveQuestionsFile(env = process.env, root = __dirname, exists = fs.existsSync) {
  if (env.QUESTIONS_FILE) return env.QUESTIONS_FILE;
  const candidates = [path.join(root, 'questions.json'), '/etc/secrets/questions.json'];
  const found = candidates.find((f) => exists(f));
  if (!found) {
    throw new Error('questions.json not found: copy questions.json.example to questions.json '
      + '(or upload it as a Render secret file, or set QUESTIONS_FILE)');
  }
  return found;
}

if (require.main === module) {
  // Last line of defence at a live event: log and keep the game running.
  process.on('uncaughtException', (err) => console.error('uncaught:', err));
  const hostKey = process.env.HOST_KEY || crypto.randomBytes(4).toString('hex');
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createServer({ questionsFile: resolveQuestionsFile(), hostKey });
  httpServer.listen(port, () => {
    console.log(`Игроки / players: http://localhost:${port}/play`);
    console.log(`Ведущий / host:   http://localhost:${port}/host?key=${hostKey}`);
  });
}

module.exports = { createServer, resolveQuestionsFile, QUESTION_MS, BAG_INTRO_MS };
