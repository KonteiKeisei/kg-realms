import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealmSearch} from '../scripts/ui-search.mjs';

test('search closes by its X, repeated Ctrl+F, and Escape before Foundry handles it', t => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });

  const handlers = new Map();
  const input = {addEventListener() {}, focus() {}};
  const button = {addEventListener(type, handler) { handlers.set(type, handler); }};
  const panels = [];
  globalThis.document = {
    createElement() {
      const panel = {
        innerHTML: '', removed: false,
        querySelector(selector) { return selector === '.close' ? button : input; },
        remove() { this.removed = true; },
      };
      panels.push(panel);
      return panel;
    },
    body: {append() {}},
  };
  const listeners = new Map();
  globalThis.window = {
    addEventListener(type, handler, capture) { assert.equal(capture, true); listeners.set(type, handler); },
    removeEventListener(type, handler, capture) {
      assert.equal(capture, true);
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const search = new RealmSearch({getLayer: () => null, getData: () => ({places: [], regions: []})});
  search.open();
  assert.match(panels[0].innerHTML, /aria-label="Close search"/);
  assert.doesNotMatch(panels[0].innerHTML, />Esc</);
  handlers.get('click')();
  assert.equal(search.el, null);
  assert.equal(listeners.size, 0);

  const key = (code, options = {}) => {
    let prevented = false, stopped = false;
    listeners.get('keydown')({
      code, key: code === 'Escape' ? 'Escape' : 'f', ...options,
      preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; },
    });
    return {prevented, stopped};
  };
  search.open();
  assert.deepEqual(key('KeyF', {ctrlKey: true}), {prevented: true, stopped: true});
  assert.equal(search.el, null);
  search.open();
  assert.deepEqual(key('Escape'), {prevented: true, stopped: true});
  assert.equal(search.el, null);
  assert.equal(listeners.size, 0);
});
