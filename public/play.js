/* global io, SHAPES, esc, bi, secondsLeft, signed, paint */
const socket = io({ auth: { role: 'player' } });
const app = document.getElementById('app');
const STORE = 'svoya-igra-player';
let me = loadMe(); // { name, token }
let state = null;
let offset = 0;
let joinError = '';
let draftName = me ? me.name : '';

function loadMe() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}

function saveMe(value) {
  try { localStorage.setItem(STORE, JSON.stringify(value)); } catch { /* private mode: no persistence */ }
}

function join(name, token) {
  socket.emit('join', { name, token }, (res) => {
    if (res && res.ok) {
      me = { name: res.name, token: res.token };
      saveMe(me);
      joinError = '';
    } else {
      joinError = (res && res.error) || 'Ошибка / Error';
      if (!state) me = null; // stored identity failed: show the join form instead of "Connecting…"
    }
    render();
  });
}

socket.on('reset', () => {
  state = null;
  if (me) join(me.name); // new game: rejoin under the same name with a fresh token
  render();
});

socket.on('connect', () => {
  if (me) join(me.name, me.token);
  else render();
});

socket.on('state', (s) => {
  offset = s.serverNow - Date.now();
  state = s;
  render();
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  draftName = app.querySelector('input[name=name]').value;
  join(draftName);
});

app.addEventListener('click', (e) => {
  const button = e.target.closest('[data-option]');
  if (!button || !state || !state.current || !state.current.canAnswer) return;
  const option = Number(button.dataset.option);
  socket.emit('answer', { option });
  state.current.canAnswer = false; // optimistic: block double taps until the server confirms
  state.current.answered = option;
  render();
});

function joinForm() {
  return `<form class="center join-form">
    <h1>Своя Игра</h1>
    <input name="name" maxlength="20" autocomplete="off" placeholder="Твоё имя / Your name" value="${esc(draftName)}" required>
    <button class="primary">Войти / Join</button>
    ${joinError ? `<p class="error">${esc(joinError)}</p>` : ''}
  </form>`;
}

function card(html) {
  return `<div class="center">${html}</div>`;
}

function waiting() {
  return card(`<h2>Ты в игре, ${esc(state.me.name)}!</h2><p>Смотри на экран</p><p class="en">You're in — watch the big screen</p>`);
}

function watching(c) {
  const who = esc(c.bagPlayer || '—');
  return card(`<h2>Мем в мешке</h2><p>Смотрим: отвечает ${who}</p><p class="en">Watching: ${who} is answering</p>`);
}

function answerButtons(c) {
  return `<div class="timer" id="timer"></div>
    <div class="answers">${c.options.map((o, i) => `<button class="answer opt${i}" data-option="${i}">
      <span class="shape">${SHAPES[i]}</span>${bi(o)}</button>`).join('')}</div>`;
}

function questionScreen(c) {
  if (c.canAnswer) return answerButtons(c);
  if (c.answered !== null) return card('<h2>Ответ принят</h2><p class="en">Answer locked in — wait for the others</p><div class="timer" id="timer"></div>');
  if (c.bag && !c.isBagPlayer) return watching(c);
  return card('<h2>Ждём…</h2><p class="en">Waiting…</p>');
}

function result(c) {
  const d = state.result.delta;
  let ru = 'Нет ответа';
  let en = 'No answer';
  if (d > 0) { ru = 'Верно!'; en = 'Correct!'; }
  if (d < 0) { ru = 'Неверно'; en = 'Wrong'; }
  if (c.bag && !c.isBagPlayer) { ru = 'Мешок был не твой'; en = 'Not your bag'; }
  return card(`<div class="delta-big ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signed(d)}</div>
    <p>${ru}</p><p class="en">${en}</p>
    <p>Правильный ответ / Correct answer:</p>
    <div class="opt opt${c.correct}"><span class="shape">${SHAPES[c.correct]}</span><div>${bi(c.options[c.correct])}</div></div>`);
}

function finalScreen() {
  return card(`<h1>Игра окончена</h1><p class="en">Game over</p>
    <div class="place">#${state.me.rank}</div><p>${state.me.score} очков / points</p>`);
}

function statusBar() {
  return `<footer class="me"><span>${esc(state.me.name)}</span><span>${state.me.score} · #${state.me.rank}</span></footer>`;
}

function screen() {
  const c = state.current;
  switch (state.phase) {
    case 'bag_intro':
      return c.isBagPlayer
        ? card(`<h1>Мем в мешке!</h1><p>Отвечаешь ты, ×2 = ${c.points}</p><p class="en">Cat in the bag — you answer, ×2</p>`)
        : watching(c);
    case 'question': return questionScreen(c);
    case 'reveal': return result(c);
    case 'final': return finalScreen();
    default: return waiting(); // lobby, board
  }
}

function render() {
  if (!me) { paint(app, joinForm()); return; }
  if (!state) { paint(app, card('<h2>Подключаемся…</h2><p class="en">Connecting…</p>')); return; }
  paint(app, screen() + statusBar());
  tick();
}

function tick() {
  const el = document.getElementById('timer');
  if (!el || !state || !state.current) return;
  el.textContent = state.current.deadline ? secondsLeft(state.current.deadline, offset, Date.now()) : '';
}

setInterval(tick, 200);
