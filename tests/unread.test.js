import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    const UNREAD_KEY'), source.indexOf('    function Icon'));
function fixture(raw) {
  const values = new Map(raw === undefined ? [] : [['dsh-deepsearch.manual-unread.v1', raw]]);
  const events = new Map();
  const window = {addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key)};
  const api = vm.runInNewContext('(function(){' + helpers + ';return {createUnreadStore,installUnread,unreadPrefs};})()', {window});
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  return {...api, storage, events, values, store: api.createUnreadStore(storage)};
}
const ids = store => Array.from(store.getSnapshot().ids);
test('unread defaults off; malformed and oversized local data is safe', () => {
  for (const raw of [undefined, '{broken', 'null', '[]', 'x'.repeat(6000001)]) {
    const {store} = fixture(raw); assert.equal(store.getSnapshot().enabled, false); assert.deepEqual(ids(store), []);
  }
  const {store} = fixture(JSON.stringify({enabled: true, ids: ['a', 'a', '', null, 9, 'b', 'x'.repeat(513)]}));
  assert.deepEqual(ids(store), ['a', 'b']);
});
test('enabled preference and marks persist, with stable snapshots and subscription cleanup', () => {
  const {store, storage, createUnreadStore} = fixture(); let changes = 0;
  const off = store.subscribe(() => changes++); assert.equal(store.getSnapshot(), store.getSnapshot());
  store.mark('ignored', true); assert.equal(changes, 0);
  store.setEnabled(true); store.mark('a', true); store.mark('a', true); store.mark('b', true);
  const restored = createUnreadStore(storage); assert.equal(restored.getSnapshot().enabled, true);
  assert.deepEqual(ids(restored), ['a', 'b']);
  off(); const before = changes; store.mark('a', false); assert.equal(changes, before); assert.deepEqual(ids(store), ['b']);
});
test('current-session marking survives unrelated updates until leaving and reopening', () => {
  const {store} = fixture(); store.setEnabled(true); store.primeActive(['a']); store.mark('a', true);
  store.observeActive(['a']); assert.deepEqual(ids(store), ['a']);
  store.observeActive(['a', 'b']); assert.deepEqual(ids(store), ['a']); // retain new before releasing old
  store.observeActive(['b']); store.observeActive(['b', 'a']); assert.deepEqual(ids(store), []);
});
test('disabled feature keeps marks including navigation, and re-enabling preserves current mark', () => {
  const {store} = fixture(); store.setEnabled(true); store.mark('a', true); store.setEnabled(false);
  store.observeActive(['a']); store.mark('a', false); store.setEnabled(true);
  store.observeActive(['a']); assert.deepEqual(ids(store), ['a']);
  store.observeActive([]); store.observeActive(['a']); assert.deepEqual(ids(store), []);
});
test('restoring while session is already open establishes baseline without deleting mark', () => {
  const {store} = fixture(JSON.stringify({enabled: true, ids: ['a', 'not-in-partial-catalog']}));
  store.primeActive(['a']); store.observeActive(['a']); assert.deepEqual(ids(store), ['a', 'not-in-partial-catalog']);
});
test('unavailable or quota-blocked storage leaves feature usable with explicit warning', () => {
  const {createUnreadStore} = fixture();
  for (const storage of [undefined, {getItem() {throw Error('blocked');}, setItem() {throw Error('quota');}}]) {
    const store = createUnreadStore(storage); store.setEnabled(true); store.mark('a', true);
    assert.deepEqual(ids(store), ['a']); assert.match(store.getError(), /无法保存/);
  }
});
test('host menu, retention edges, storage updates, and cleanup use only public services', () => {
  const {store, installUnread, storage, events} = fixture(); let menu, listener, removed = 0;
  let byId = {a: {id: 'a', retainedBy: {mainView: 1}}};
  const stop = installUnread({sessions: {list: {getSnapshot: () => ({byId}), subscribe: fn => {listener = fn; return () => removed++;}}},
    contextMenus: {register: entry => {menu = entry; return () => removed++;}}}, store);
  assert.equal(menu.target, 'session'); assert.deepEqual(Array.from(menu.resolve({sessionId: 'a'})), []);
  store.setEnabled(true); assert.equal(menu.observe()[0], store);
  menu.resolve({sessionId: 'a'})[0].run(); assert.equal(menu.resolve({sessionId: 'a'})[0].label, '标记为已读');
  listener(); assert.deepEqual(ids(store), ['a']);
  byId = {a: {id: 'a', retainedBy: {}}, b: {id: 'b', retainedBy: {mainView: 1}}}; listener();
  byId.a.retainedBy.mainView = 1; listener(); assert.deepEqual(ids(store), []);
  storage.setItem('dsh-deepsearch.manual-unread.v1', JSON.stringify({enabled: true, ids: ['b']}));
  events.get('storage')({key: 'dsh-deepsearch.manual-unread.v1'}); assert.deepEqual(ids(store), ['b']);
  stop(); assert.equal(removed, 2); assert.equal(events.size, 0);
});
test('real plugin registers additive trailing dot with enabled reactive selector', () => {
  let plugin, dot, definition;
  const ctx = {effect: () => {}, slots: {inject: (name, cb) => {if (name === 'sidebar.session.row.trailing') cb();},
    register: (def, component) => {definition = def; dot = component;}}};
  const React = {createElement: (tag, props) => ({tag, props})};
  vm.runInNewContext(source, {window: {__ModuleLoader__: {load: config => {plugin = config.factory(name => React);}}}});
  plugin.apply(ctx); assert.equal(definition.name, 'sidebar.session.row.trailing');
  const store = definition.inject().hooks.manualUnread;
  const render = () => dot({sessionId: 'a', useManualUnread: select => select(store.getSnapshot())});
  assert.equal(render(), null); store.setEnabled(true); store.mark('a', true);
  assert.equal(render().props['aria-label'], '手动未读');
  store.setEnabled(false); assert.equal(render(), null); assert.deepEqual(ids(store), ['a']);
  assert.doesNotMatch(helpers, /MutationObserver|data-deepsearch-unread/);
  assert.match(source, /role: 'switch'/); assert.match(source, /'aria-checked': unread.enabled/);
});
