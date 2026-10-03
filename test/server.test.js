const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../server');

const KEY = 'test-key';

async function boot(opts = {}) {
  const srv = createServer({
    questionsFile: path.join(__dirname, '..', 'questions.json.example'),
    hostKey: KEY,
    questionMs: 5000,
    bagIntroMs: 50,
    ...opts,
  });
  await new Promise((resolve) => srv.httpServer.listen(0, resolve));
  const url = `http://localhost:${srv.httpServer.address().port}`;
  const clients = [];
  const client = (auth) => {
    const s = connect(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(s);
    return s;
  };
  const close = async () => {
    clients.forEach((c) => c.disconnect());
    await new Promise((resolve) => srv.io.close(resolve));
  };
  return { srv, url, client, close };
}

function waitState(socket, pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('state', on); reject(new Error('timeout waiting for state')); }, ms);
    function on(s) {
      if (pred(s)) { clearTimeout(timer); socket.off('state', on); resolve(s); }
    }
    socket.on('state', on);
  });
}

const join = (s, name, token) => new Promise((resolve) => s.emit('join', { name, token }, resolve));

async function hostAndStart(client) {
  const host = client({ role: 'host', key: KEY });
  await waitState(host, (s) => s.phase === 'lobby');
  return host;
}

test('pages, QR and wrong host key', async () => {
  const { client, url, close } = await boot();
  try {
    const qr = await fetch(`${url}/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(`${url}/play`)).status, 200);
    assert.equal((await fetch(`${url}/host`)).status, 200);
    const bad = client({ role: 'host', key: 'nope' });
    await new Promise((resolve) => bad.on('auth_error', resolve));
  } finally { await close(); }
});

test('invalid name is rejected via ack', async () => {
  const { client, close } = await boot();
  try {
    const p = client({ role: 'player' });
    const res = await join(p, '   ');
    assert.equal(res.ok, false);
    assert.match(res.error, /1–20/);
  } finally { await close(); }
});

test('round: answer closes early when everyone answered, reveal shows delta', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const p = client({ role: 'player' });
    assert.equal((await join(p, 'Аня')).ok, true);
    let next = waitState(host, (s) => s.phase === 'board');
    host.emit('start');
    await next;
    next = waitState(p, (s) => s.phase === 'question');
    host.emit('open', { theme: 0, value: 100 });
    const q = await next;
    assert.equal(q.current.canAnswer, true);
    assert.equal(q.current.correct, null);
    assert.equal(typeof q.serverNow, 'number');
    next = waitState(p, (s) => s.phase === 'reveal');
    const started = Date.now();
    p.emit('answer', { option: 0 }); // example theme 0 / 100: correct option is 0
    const r = await next;
    assert.ok(Date.now() - started < 2000, 'closed early, not by the 5 s timer');
    assert.equal(r.result.delta, 100);
    assert.equal(r.me.score, 100);
    assert.equal(r.current.correct, 0);
  } finally { await close(); }
});

test('timer closes the question when nobody answers', async () => {
  const { client, close } = await boot({ questionMs: 300 });
  try {
    const host = await hostAndStart(client);
    const p = client({ role: 'player' });
    await join(p, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const next = waitState(p, (s) => s.phase === 'reveal');
    host.emit('open', { theme: 0, value: 200 });
    const r = await next;
    assert.equal(r.result.delta, 0);
  } finally { await close(); }
});

test('reconnect with token keeps score; closing a second tab keeps the player online', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const tab1 = client({ role: 'player' });
    const first = await join(tab1, 'Боря');
    const tab2 = client({ role: 'player' });
    const second = await join(tab2, 'ignored', first.token);
    assert.equal(second.playerId, first.playerId);
    assert.equal(second.name, 'Боря');
    tab1.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = waitState(host, (s) => s.phase === 'board');
    host.emit('start');
    const board = await next;
    assert.equal(board.playerCount, 1);

    const answered = waitState(tab2, (s) => s.phase === 'reveal');
    host.emit('open', { theme: 0, value: 100 });
    await waitState(tab2, (s) => s.phase === 'question');
    tab2.emit('answer', { option: 0 });
    await answered;
    tab2.disconnect();

    const tab3 = client({ role: 'player' });
    const firstState = waitState(tab3, () => true); // listen before join: ack and state can arrive together
    const third = await join(tab3, 'x', first.token);
    assert.equal(third.playerId, first.playerId);
    const s = await firstState;
    assert.equal(s.me.score, 100);
  } finally { await close(); }
});

test('disconnect mid-question closes it when everyone left has answered', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    const b = client({ role: 'player' });
    await join(a, 'Аня');
    await join(b, 'Боря');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const opened = waitState(a, (s) => s.phase === 'question');
    host.emit('open', { theme: 1, value: 100 });
    await opened;
    a.emit('answer', { option: 3 });
    await waitState(host, (s) => s.current && s.current.answeredCount === 1);
    const revealed = waitState(host, (s) => s.phase === 'reveal');
    b.disconnect();
    const r = await revealed;
    assert.equal(r.ranking.find((x) => x.name === 'Аня').delta, 100);
  } finally { await close(); }
});

test('bag cell: intro, then only the addressee can answer for double points', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    await join(a, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const intro = waitState(host, (s) => s.phase === 'bag_intro');
    const question = waitState(a, (s) => s.phase === 'question');
    host.emit('open', { theme: 3, value: 300 });
    const i = await intro;
    assert.equal(i.current.bagPlayer, 'Аня');
    const q = await question;
    assert.equal(q.current.isBagPlayer, true);
    assert.equal(q.current.points, 600);
    const reveal = waitState(a, (s) => s.phase === 'reveal');
    a.emit('answer', { option: 3 });
    const r = await reveal;
    assert.equal(r.result.delta, 600);
  } finally { await close(); }
});

test('host end goes to final from a question', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    host.emit('open', { theme: 0, value: 100 });
    await waitState(host, (s) => s.phase === 'question');
    const fin = waitState(host, (s) => s.phase === 'final');
    host.emit('end');
    await fin;
  } finally { await close(); }
});

test('malformed payloads do not crash the server', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const p = client({ role: 'player' });
    for (const bad of [null, 42, 'x']) {
      p.emit('join', bad);
      p.emit('answer', bad);
      host.emit('open', bad);
    }
    host.emit('open', { theme: 'length', value: 100 });
    host.emit('open', { theme: 0, value: '100' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await join(client({ role: 'player' }), 'Живой');
    assert.equal(res.ok, true);
  } finally { await close(); }
});

test('one socket cannot create a second player', async () => {
  const { client, close } = await boot();
  try {
    const p = client({ role: 'player' });
    assert.equal((await join(p, 'Аня')).ok, true);
    const again = await join(p, 'Спам');
    assert.equal(again.ok, false);
  } finally { await close(); }
});

test('host close during bag intro does not freeze the game', async () => {
  const { client, close } = await boot({ bagIntroMs: 150 });
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    await join(a, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    const intro = waitState(host, (s) => s.phase === 'bag_intro');
    host.emit('open', { theme: 3, value: 300 });
    await intro;
    const question = waitState(host, (s) => s.phase === 'question');
    host.emit('close');
    await question;
  } finally { await close(); }
});

test('host reset after the final starts a fresh lobby and players rejoin', async () => {
  const { client, close } = await boot();
  try {
    const host = await hostAndStart(client);
    const a = client({ role: 'player' });
    await join(a, 'Аня');
    host.emit('start');
    await waitState(host, (s) => s.phase === 'board');
    host.emit('open', { theme: 0, value: 100 });
    await waitState(a, (s) => s.phase === 'question');
    a.emit('answer', { option: 0 });
    await waitState(a, (s) => s.phase === 'reveal');
    host.emit('reset'); // ignored outside final
    host.emit('end');
    await waitState(host, (s) => s.phase === 'final');
    const resetSeen = new Promise((resolve) => a.once('reset', resolve));
    const lobby = waitState(host, (s) => s.phase === 'lobby' && s.playerCount === 0);
    host.emit('reset');
    await lobby;
    await resetSeen;
    const fresh = waitState(a, (s) => s.phase === 'lobby');
    const res = await join(a, 'Аня');
    assert.equal(res.ok, true);
    const s = await fresh;
    assert.equal(s.me.score, 0);
  } finally { await close(); }
});

test('resolveQuestionsFile: env override, then local file, then Render secret file', () => {
  const { resolveQuestionsFile } = require('../server');
  const root = '/app';
  const exists = (set) => (f) => set.includes(f);
  assert.equal(resolveQuestionsFile({ QUESTIONS_FILE: '/x/q.json' }, root, exists([])), '/x/q.json');
  assert.equal(resolveQuestionsFile({}, root, exists(['/app/questions.json'])), '/app/questions.json');
  assert.equal(resolveQuestionsFile({}, root, exists(['/etc/secrets/questions.json'])), '/etc/secrets/questions.json');
  assert.throws(() => resolveQuestionsFile({}, root, exists([])), /questions\.json\.example/);
});
