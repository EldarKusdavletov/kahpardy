// Usage: node scripts/bots.js [url] [count]
// Joins `count` bot players and answers every question randomly 1–10 s after it opens.
const { io } = require('socket.io-client');

const url = process.argv[2] || 'http://localhost:3000';
const count = Number(process.argv[3] || 60);
let joined = 0;
let answered = 0;
let maxLagMs = 0;

for (let i = 0; i < count; i += 1) {
  const socket = io(url, { auth: { role: 'player' }, transports: ['websocket'] });
  let lastKey = null;
  socket.on('connect', () => {
    socket.emit('join', { name: `bot${i + 1}` }, (res) => { if (res && res.ok) joined += 1; });
  });
  socket.on('state', (s) => {
    maxLagMs = Math.max(maxLagMs, Date.now() - s.serverNow);
    const c = s.current;
    if (s.phase === 'question' && c && c.canAnswer && c.key !== lastKey) {
      lastKey = c.key;
      setTimeout(() => {
        socket.emit('answer', { option: Math.floor(Math.random() * 4) });
        answered += 1;
      }, 1000 + Math.random() * 9000);
    }
  });
}

setInterval(() => {
  console.log(`joined ${joined}/${count} · answers sent ${answered} · max state lag ${maxLagMs} ms`);
}, 2000);
