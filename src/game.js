'use strict';
const crypto = require('crypto');

const BAG_MULTIPLIER = 2;
const NAME_ERROR = 'Имя: от 1 до 20 символов / Name: 1–20 characters';
const FULL_ERROR = 'Игра заполнена / Game is full';

class Game {
  constructor(questions, { questionMs = 15000, maxPlayers = 150, random = Math.random } = {}) {
    this.questions = questions;
    this.questionMs = questionMs;
    this.maxPlayers = maxPlayers;
    this.random = random;
    this.phase = 'lobby';
    this.players = new Map(); // id -> { id, name, score, token, connected }
    this.byToken = new Map();
    this.played = new Set(); // "themeIndex:value"
    this.chooserId = null;
    this.current = null; // { themeIndex, key, question, answers: Map(id -> {option, at}), openedAt, bagPlayerId }
    this.lastResult = null;
    this.nextId = 1;
  }

  join(name, token) {
    const known = token ? this.byToken.get(token) : null;
    if (known) {
      known.connected = true;
      return known;
    }
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean.length < 1 || clean.length > 20) throw new Error(NAME_ERROR);
    if (this.players.size >= this.maxPlayers) throw new Error(FULL_ERROR);
    const player = {
      id: String(this.nextId++),
      name: this.uniqueName(clean),
      score: 0,
      token: crypto.randomUUID(),
      connected: true,
    };
    this.players.set(player.id, player);
    this.byToken.set(player.token, player);
    return player;
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n += 1) {
      const candidate = `${name} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  disconnect(playerId) {
    const player = this.players.get(playerId);
    if (player) player.connected = false;
  }

  start() {
    if (this.phase !== 'lobby') return false;
    this.phase = 'board';
    return true;
  }

  openCell(themeIndex, value, now) {
    if (this.phase !== 'board' || !Number.isInteger(themeIndex) || !Number.isInteger(value)) return false;
    const theme = this.questions.themes[themeIndex];
    const question = theme ? theme.questions.find((q) => q.value === value) : null;
    const key = `${themeIndex}:${value}`;
    if (!question || this.played.has(key)) return false;
    this.played.add(key);
    this.current = { themeIndex, key, question, answers: new Map(), openedAt: null, bagPlayerId: null };
    if (question.bag) {
      this.current.bagPlayerId = this.pickBagPlayer();
      this.phase = 'bag_intro';
    } else {
      this.current.openedAt = now;
      this.phase = 'question';
    }
    return true;
  }

  pickBagPlayer() {
    const chooser = this.players.get(this.chooserId);
    if (chooser && chooser.connected) return chooser.id;
    const online = this.connectedPlayers();
    if (online.length === 0) return null;
    return online[Math.floor(this.random() * online.length)].id;
  }

  beginBagQuestion(now) {
    if (this.phase !== 'bag_intro') return false;
    this.current.openedAt = now;
    this.phase = 'question';
    return true;
  }

  canAnswer(playerId) {
    if (this.phase !== 'question') return false;
    if (!this.players.has(playerId) || this.current.answers.has(playerId)) return false;
    return !this.current.question.bag || this.current.bagPlayerId === playerId;
  }

  answer(playerId, option, now) {
    if (!this.canAnswer(playerId)) return false;
    if (!Number.isInteger(option) || option < 0 || option > 3) return false;
    this.current.answers.set(playerId, { option, at: now });
    return true;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  eligiblePlayers() {
    if (!this.current) return [];
    if (this.current.question.bag) {
      const p = this.players.get(this.current.bagPlayerId);
      return p && p.connected ? [p] : [];
    }
    return this.connectedPlayers();
  }

  allAnswered() {
    if (this.phase !== 'question') return false;
    const eligible = this.eligiblePlayers();
    return eligible.length > 0 && eligible.every((p) => this.current.answers.has(p.id));
  }

  closeQuestion() {
    if (this.phase !== 'question') return null;
    const q = this.current.question;
    const value = q.bag ? q.value * BAG_MULTIPLIER : q.value;
    const deltas = {};
    const counts = [0, 0, 0, 0];
    let fastest = null;
    for (const [id, a] of this.current.answers) {
      const player = this.players.get(id);
      const ok = a.option === q.correct;
      const delta = ok ? value : -value;
      player.score += delta;
      deltas[id] = delta;
      counts[a.option] += 1;
      if (ok && (!fastest || a.at < fastest.at)) fastest = { id, at: a.at };
    }
    this.chooserId = fastest ? fastest.id : null;
    this.lastResult = { deltas, counts, fastestId: this.chooserId, value };
    this.phase = 'reveal';
    return this.lastResult;
  }

  toBoard() {
    if (this.phase !== 'reveal') return false;
    this.current = null;
    this.phase = this.played.size >= this.totalCells() ? 'final' : 'board';
    return true;
  }

  end() {
    if (this.phase === 'final') return false;
    this.current = null;
    this.phase = 'final';
    return true;
  }

  totalCells() {
    return this.questions.themes.reduce((n, t) => n + t.questions.length, 0);
  }

  nameOf(playerId) {
    const p = this.players.get(playerId);
    return p ? p.name : null;
  }

  ranking() {
    const list = [...this.players.values()].sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    let rank = 0;
    return list.map((p, i) => {
      if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
      return { id: p.id, name: p.name, score: p.score, rank };
    });
  }

  currentView() {
    if (!this.current) return null;
    const { question: q, themeIndex, key } = this.current;
    return {
      key,
      themeName: this.questions.themes[themeIndex].name,
      value: q.value,
      points: q.bag ? q.value * BAG_MULTIPLIER : q.value,
      bag: Boolean(q.bag),
      bagPlayer: q.bag ? this.nameOf(this.current.bagPlayerId) : null,
      text: q.text,
      options: q.options,
      image: q.image || null,
      deadline: this.phase === 'question' ? this.current.openedAt + this.questionMs : null,
      answeredCount: this.current.answers.size,
      eligibleCount: this.eligiblePlayers().length,
      correct: this.phase === 'reveal' ? q.correct : null,
    };
  }

  hostView() {
    const reveal = this.phase === 'reveal';
    const deltas = reveal ? this.lastResult.deltas : {};
    const online = this.connectedPlayers();
    return {
      phase: this.phase,
      title: this.questions.title || 'Своя Игра',
      themes: this.questions.themes.map((t, ti) => ({
        name: t.name,
        cells: t.questions
          .map((q) => ({ value: q.value, played: this.played.has(`${ti}:${q.value}`) }))
          .sort((x, y) => x.value - y.value),
      })),
      players: online.map((p) => p.name),
      playerCount: online.length,
      chooser: this.nameOf(this.chooserId),
      ranking: this.ranking().slice(0, 10).map((r) => ({
        name: r.name, score: r.score, rank: r.rank, delta: r.id in deltas ? deltas[r.id] : null,
      })),
      current: this.currentView(),
      result: reveal ? { counts: this.lastResult.counts, fastest: this.nameOf(this.lastResult.fastestId) } : null,
    };
  }

  playerView(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    const me = this.ranking().find((r) => r.id === playerId);
    const current = this.currentView();
    if (current) {
      const a = this.current.answers.get(playerId);
      current.canAnswer = this.canAnswer(playerId);
      current.answered = a ? a.option : null;
      current.isBagPlayer = current.bag && this.current.bagPlayerId === playerId;
    }
    const reveal = this.phase === 'reveal';
    return {
      phase: this.phase,
      me: { name: player.name, score: player.score, rank: me.rank },
      playerCount: this.connectedPlayers().length,
      current,
      result: reveal
        ? { delta: this.lastResult.deltas[playerId] ?? 0, fastest: this.nameOf(this.lastResult.fastestId) }
        : null,
    };
  }
}

module.exports = { Game, BAG_MULTIPLIER, NAME_ERROR, FULL_ERROR };
