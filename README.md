# Kahpardy

**Jeopardy × Kahoot** — a live quiz for a room full of people. The Jeopardy board («Своя игра») is on the
projector, and every player answers Kahoot-style from their own phone (4 coloured buttons, join by QR).
Built for ~60 students at UNIST; all texts are bilingual RU/EN.

- Jeopardy rules: pick a cell, `+value` for a right answer, `−value` for a wrong one, the fastest correct
  player picks next, one hidden «Мем в мешке» (cat in the bag) cell worth ×2.
- Kahoot feel: everyone answers at once from their phone, a timer runs, then answer stats and a top-5 appear.
- No accounts and no build step: one Node.js process (Express + Socket.IO). Runs on the Render free tier.

## Run locally

```bash
npm install
cp questions.json.example questions.json   # then put your own questions in
HOST_KEY=secret npm start
```

- Projector (host): `http://localhost:3000/host?key=secret`
- Players: `http://localhost:3000/play` (the QR on the host lobby points here)

Without `HOST_KEY` a random key is generated and printed at startup.

## Tests

```bash
npm test                                   # unit + integration
npm run bots -- http://localhost:3000 60   # 60 bot players (load test)
```

## Questions

The real questions live in `questions.json`, which is **git-ignored** so players can't read the answers on GitHub.
Start from `questions.json.example`: 4 themes × 3 questions, each with `text` and 4 `options` in `ru`/`en`,
`correct` = 0..3, optional `image` (file name in `public/img/`), exactly one question with `"bag": true`
(«Мем в мешке»). The server refuses to start and lists every problem if the file is invalid.

The server looks for the file in this order: `$QUESTIONS_FILE` → `./questions.json` → `/etc/secrets/questions.json`.
Tests run against `questions.json.example` (and also validate your local `questions.json` if present).

## Deploy to Render (free)

1. Push this repo to GitHub.
2. render.com → New → Web Service → pick the repo.
   - Runtime: Node · Build command: `npm install` · Start command: `npm start` · Instance type: Free
   - Environment → add `HOST_KEY` = a secret only the host knows.
   - Environment → Secret Files → add `questions.json` with the contents of your local `questions.json`.
3. Deploy. Host: `https://<name>.onrender.com/host?key=<HOST_KEY>`, players: `https://<name>.onrender.com/play`.
4. Load test once: `npm run bots -- https://<name>.onrender.com 60`, play it to the end, then press
   «Новая игра / New game» on the results screen (or Render → Manual Deploy → Restart) so the bots are gone.

The free instance sleeps after 15 minutes without traffic and needs ~1 minute to wake up:
**open the host page at least 2 minutes before the game.** Game state lives in memory — a restart resets it.

## Backup: run from the laptop

```bash
HOST_KEY=secret npm start
cloudflared tunnel --url http://localhost:3000   # brew install cloudflared
```

Use the printed `https://….trycloudflare.com` address (`/host?key=secret` and `/play`). The link changes on every run.

## Day-of checklist

- Open `/host?key=…` 2+ minutes early (wakes Render), projector in full screen (F11 / ⌃⌘F).
- Join from your own phone first to check the QR and the buttons.
- After any rehearsal: «Завершить игру» → «Новая игра» — the lobby must be empty (0 players) before the real game.
- The host key disappears from the address bar after the page loads; a reload keeps working in the same tab.
- Keep the laptop backup ready (`npm start` + `cloudflared`).
