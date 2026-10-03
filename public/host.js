/* global io, SHAPES, esc, bi, secondsLeft, signed, paint */
const KEY_STORE = 'svoya-igra-host-key';
const hostKey = readHostKey();
const socket = io({ auth: { role: 'host', key: hostKey } });

// Keep the key off the projected address bar; sessionStorage lets a reload reconnect.
function readHostKey() {
  const fromUrl = new URLSearchParams(location.search).get('key');
  let key = fromUrl || '';
  try {
    if (fromUrl) sessionStorage.setItem(KEY_STORE, fromUrl);
    else key = sessionStorage.getItem(KEY_STORE) || '';
  } catch { /* storage blocked: the key only lives in the URL */ }
  if (fromUrl) history.replaceState(null, '', location.pathname);
  return key;
}
const app = document.getElementById('app');
let state = null;
let offset = 0;
let confirmingEnd = false;

socket.on('auth_error', () => {
  paint(app, '<div class="center"><h1>Неверный ключ ведущего</h1><p class="en">Wrong host key — open /host?key=YOUR_KEY</p></div>');
});

socket.on('state', (s) => {
  offset = s.serverNow - Date.now();
  state = s;
  if (s.phase === 'final') confirmingEnd = false;
  render();
});

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'open') socket.emit('open', { theme: Number(el.dataset.theme), value: Number(el.dataset.value) });
  else if (action === 'end-ask') { confirmingEnd = true; render(); }
  else if (action === 'end-cancel') { confirmingEnd = false; render(); }
  else if (action === 'end-confirm') { confirmingEnd = false; socket.emit('end'); }
  else socket.emit(action); // start | close | board | reset
});

function row(r) {
  const delta = r.delta == null ? '' : `<span class="delta ${r.delta > 0 ? 'up' : 'down'}">${signed(r.delta)}</span>`;
  return `<li><span class="rank">${r.rank}</span><span class="name">${esc(r.name)}</span>${delta}<span class="score">${r.score}</span></li>`;
}

function leaders(n) {
  if (state.ranking.length === 0) return '<p class="en">Пока никого / No players yet</p>';
  return `<ol class="top">${state.ranking.slice(0, n).map(row).join('')}</ol>`;
}

function lobby() {
  return `<div class="center lobby">
    <h1>${esc(state.title)}</h1>
    <div class="join">
      <img class="qr" src="/qr.svg" alt="QR">
      <div>
        <p class="big">${esc(location.host)}/play</p>
        <p>Игроков / Players: <b>${state.playerCount}</b></p>
      </div>
    </div>
    <div class="names">${state.players.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
    <button class="primary" data-action="start">Начать игру / Start</button>
  </div>`;
}

function board() {
  const rows = state.themes.map((t, ti) => `<tr><th>${bi(t.name)}</th>${t.cells.map((c) => `<td>${
    c.played ? '<span class="played"></span>'
      : `<button data-action="open" data-theme="${ti}" data-value="${c.value}">${c.value}</button>`
  }</td>`).join('')}</tr>`).join('');
  const chooser = state.chooser
    ? `Выбирает / Choosing: <b>${esc(state.chooser)}</b>`
    : 'Выбирает ведущий / Host chooses';
  return `<div class="board-wrap">
    <table class="board">${rows}</table>
    <aside><p class="chooser">${chooser}</p>${leaders(5)}</aside>
  </div>`;
}

function bagIntro() {
  const c = state.current;
  const who = c.bagPlayer ? esc(c.bagPlayer) : '—';
  return `<div class="center bag">
    <h1>Мем в мешке!</h1>
    <p class="en">Cat in the bag</p>
    <p>Отвечает / Answering: <b>${who}</b></p>
    <p>×2 = ${c.points}</p>
  </div>`;
}

function question() {
  const c = state.current;
  const reveal = state.phase === 'reveal';
  const options = c.options.map((o, i) => {
    const mark = reveal ? (i === c.correct ? 'correct' : 'wrong') : '';
    const count = reveal ? `<span class="count">${state.result.counts[i]}</span>` : '';
    return `<div class="opt opt${i} ${mark}"><span class="shape">${SHAPES[i]}</span><div>${bi(o)}</div>${count}</div>`;
  }).join('');
  const foot = reveal
    ? `<div>${state.result.fastest ? `Быстрее всех верно / Fastest correct: <b>${esc(state.result.fastest)}</b>` : 'Никто не ответил верно / Nobody got it'}</div>
       ${leaders(5)}
       <button class="primary" data-action="board">К табло / Board</button>`
    : `<div>Ответили / Answered: <b>${c.answeredCount}/${c.eligibleCount}</b></div>
       <button class="ghost" data-action="close">Закрыть досрочно / Close now</button>`;
  return `<div class="q">
    <div class="q-head"><div>${bi(c.themeName)} · ${c.points}${c.bag ? ' (×2)' : ''}</div><div class="timer" id="timer"></div></div>
    ${c.bag ? `<p class="bag-note">Мем в мешке — отвечает ${esc(c.bagPlayer || '—')}</p>` : ''}
    <h2 class="q-text">${bi(c.text)}</h2>
    ${c.image ? `<img class="q-img" src="/img/${encodeURIComponent(c.image)}" alt="">` : ''}
    <div class="options">${options}</div>
    <div class="q-foot">${foot}</div>
  </div>`;
}

function final() {
  const r = state.ranking;
  const podium = [[r[1], 2], [r[0], 1], [r[2], 3]].map(([p, place]) => (p
    ? `<div class="step step${place}"><div class="name">${esc(p.name)}</div><div>${p.score}</div><div class="block">${p.rank}</div></div>`
    : '<div class="step"></div>')).join('');
  return `<div class="center">
    <h1>Итоги / Results</h1>
    <div class="podium">${podium}</div>
    <ol class="top">${r.slice(3, 10).map(row).join('')}</ol>
    <button class="ghost" data-action="reset">Новая игра / New game</button>
  </div>`;
}

function endControls() {
  if (state.phase === 'final') return '';
  return confirmingEnd
    ? `<div class="end-controls">Завершить игру? / End game?
        <button class="primary" data-action="end-confirm">Да / Yes</button>
        <button class="ghost" data-action="end-cancel">Нет / No</button></div>`
    : '<div class="end-controls"><button class="ghost" data-action="end-ask">Завершить игру / End game</button></div>';
}

const VIEWS = { lobby, board, bag_intro: bagIntro, question, reveal: question, final };

function render() {
  if (!state) return;
  paint(app, VIEWS[state.phase]() + endControls());
  tick();
}

function tick() {
  const el = document.getElementById('timer');
  if (!el || !state || !state.current) return;
  el.textContent = state.current.deadline ? secondsLeft(state.current.deadline, offset, Date.now()) : '';
}

setInterval(tick, 200);
