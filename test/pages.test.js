const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Browsers make window.top / location / document / window non-configurable,
// so a top-level `function top()` or `let location` in a classic script throws at load.
function browserLikeContext({ search = '' } = {}) {
  const noop = () => {};
  const calls = [];
  const store = new Map();
  const el = { addEventListener: noop, querySelector: () => null };
  const ctx = {
    io: () => ({ on: noop, emit: noop }),
    setInterval: noop,
    URLSearchParams,
    localStorage: { getItem: () => null, setItem: noop },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    history: { replaceState: (...args) => calls.push(args) },
    calls,
  };
  for (const [key, value] of Object.entries({
    top: {}, window: {}, location: { search, host: 'test', pathname: '/host' }, document: { getElementById: () => el },
  })) {
    Object.defineProperty(ctx, key, { value, configurable: false, enumerable: true });
  }
  return vm.createContext(ctx);
}

for (const file of ['common.js', 'host.js', 'play.js']) {
  test(`${file} loads in a browser-like global scope`, () => {
    const context = browserLikeContext();
    const common = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
    if (file !== 'common.js') vm.runInContext(common, context);
    const code = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
    assert.doesNotThrow(() => vm.runInContext(code, context, { filename: file }));
  });
}

test('host.js removes the key from the address bar but keeps it for reloads', () => {
  const context = browserLikeContext({ search: '?key=secret' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'host.js'), 'utf8'), context);
  assert.deepEqual(context.calls, [[null, '', '/host']]);
  assert.equal(context.sessionStorage.getItem('svoya-igra-host-key'), 'secret');
});
