(function (root) {
  const SHAPES = ['▲', '◆', '●', '■'];
  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  }

  function bi(t) {
    const ru = `<span class="ru">${esc(t && t.ru)}</span>`;
    return t && t.en && t.en !== t.ru ? `${ru}<span class="en">${esc(t.en)}</span>` : ru;
  }

  // offset = serverNow - clientNow at the moment the state arrived
  function secondsLeft(deadline, offset, now) {
    if (!deadline) return 0;
    return Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
  }

  function signed(n) {
    return n > 0 ? `+${n}` : String(n);
  }

  // Rebuild the DOM only when the markup changed, so taps are not lost to re-renders.
  function paint(el, html) {
    if (el._html === html) return false;
    el.innerHTML = html;
    el._html = html;
    return true;
  }

  const api = { SHAPES, esc, bi, secondsLeft, signed, paint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
