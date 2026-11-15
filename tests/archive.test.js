import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function observable(value) {
  const listeners = new Set();
  return {getSnapshot: () => value, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    set(next) {value = next; for (const fn of [...listeners]) fn();}};
}
// Execute the actual plugin factory, apply(), Overlay hooks/effects and event handlers.
// No extracted/reimplemented archive controller: navigation is the production beginJump.
function harness({rows = [{id:'hit', sessionId:'target', title:'Archived title', kind:'message', seq:7, archived:true}],
  archive = ['target'], phase = 'ready', state = 'idle', recovery, missingAPI = false, missingStore = false} = {}) {
  let plugin, Overlay, tree, cursor = 0, dirty = false, mounted = true, timerId = 0;
  const hooks = [], effects = [], stores = [], timers = new Map(), windowEvents = new Map(), disposers = [], calls = [];
  const binding = observable({key:'old'}), panel = observable({activePanelId:null});
  const workspaces = observable({phase, state, archivedSessionIds:archive});
  const session = observable({loadingOlder:false, hasMore:false}); session.loadThrough = async () => {};
  const React = {
    Fragment: 'fragment',
    createElement(tag, props, ...children) {return {tag, props:props || {}, children:children.flat()};},
    useState(initial) {const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], next => {const value = typeof next === 'function' ? next(hooks[i]) : next; if (!Object.is(value, hooks[i])) {hooks[i] = value; dirty = true;}}];},
    useRef(initial) {const i = cursor++; return hooks[i] ||= {current:initial};},
    useSyncExternalStore(subscribe, getSnapshot) {const i = cursor++; if (!stores[i]) stores[i] = subscribe(() => {dirty = true;}); return getSnapshot();},
    useEffect(callback, deps) {const i = cursor++, old = effects[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) pending.push({i, callback, deps});},
  };
  let pending = [];
  const ctx = {
    contextMenus: {register: () => () => {}},
    workspaces: missingStore ? undefined : {list:workspaces},
    uiWorkspace: {openSession(id) {calls.push(['open', id]); binding.set({key:id});},
      unarchiveSession: missingAPI ? undefined : id => {calls.push(['unarchive', id]); return recovery ? recovery(id, workspaces) : Promise.resolve().then(() => workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}));}},
    uiSession: {adapter:{current:binding}},
    sessions: {list:observable({byId:{}}), retain(id, options) {calls.push(['retain', id, options.source]); return {ready:Promise.resolve(), binding:{session, eventSource:{getSnapshot:() => ({entries:[{type:'event', event:{seq:7}}]})}}, release() {calls.push(['release', id]);}};}},
    layout: {panelInfo:panel, selectPanel(id) {calls.push(['panel', id]); panel.set({activePanelId:id});}},
    effect(fn) {disposers.push(fn());},
    slots: {inject(name, fn) {fn(); return () => {};}, register(options, component) {if (options.name === 'shell.overlay') Overlay = component;}},
  };
  const document = {baseURI:'http://localhost/', activeElement:null, addEventListener() {}, removeEventListener() {}};
  const window = {localStorage:{getItem:() => null}, addEventListener:(name, fn) => windowEvents.set(name, fn), removeEventListener:name => windowEvents.delete(name),
    __ModuleLoader__:{load(definition) {plugin = definition.factory(name => {assert.equal(name, 'react'); return React;});}}};
  vm.runInNewContext(source, {window, document, AbortController, AbortSignal, URL, React,
    setTimeout(fn, delay) {const id = ++timerId; timers.set(id, {fn, delay}); return id;}, clearTimeout:id => timers.delete(id),
    fetch: async url => ({ok:true, text:async () => JSON.stringify(String(url).endsWith('/catalog') ? {sessions:[], workspaces:[]} : {items:rows, cursor:null, scanned:1, totalSessions:1, warnings:[]})}),
  });
  plugin.apply(ctx);
  function nodes(node = tree) {if (!node || typeof node !== 'object') return []; return [node, ...node.children.flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];}
  function render() {
    if (!mounted) return;
    let turns = 0;
    do {
      assert.ok(turns++ < 30, 'hooks settle'); cursor = 0; pending = []; dirty = false; tree = Overlay();
      for (const node of nodes()) if (node.props.ref) node.props.ref.current ||= {focus() {}, contains:() => true, querySelector:() => null, querySelectorAll:() => []};
      for (const {i, callback, deps} of pending) {effects[i]?.cleanup?.(); effects[i] = {deps, cleanup:callback()};}
    } while (dirty);
  }
  const find = predicate => nodes().find(predicate);
  const button = label => find(node => node.tag === 'button' && node.children.includes(label));
  const input = () => find(node => node.props['aria-label'] === '搜索会话正文');
  const click = node => {assert.ok(node, 'target exists'); node.props.onClick(); render();};
  const tick = async () => {for (let i = 0; i < 15; i++) {await Promise.resolve(); if (dirty) render();}};
  const expire = delay => {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id); timer.fn();} render();};
  function key(key) {tree.props.onKeyDown({key, target:input().props.ref.current, preventDefault() {}, stopPropagation() {}}); render();}
  async function search() {windowEvents.get('keydown')({key:'k', metaKey:true, shiftKey:true, preventDefault() {}, stopPropagation() {}}); render();
    input().props.onChange({target:{value:'Archived'}}); render(); expire(220); await tick();}
  render();
  return {ctx, calls, plugin, workspaces, tick, expire, key, search, render, nodes, find, button, input, click,
    get tree() {return tree;}, get text() {return nodes().flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ');},
    result:() => find(node => node.props.role === 'option'),
    unmount() {mounted = false; for (const effect of effects) effect?.cleanup?.(); for (const unsubscribe of stores) unsubscribe?.();},
    dispose() {for (const dispose of disposers) dispose?.(); render();},
  };
}

test('archived message and plain title badges open an owned inline prompt; cancel retains results', async () => {
  for (const kind of ['message', 'title']) {
    const h = harness({rows:[{id:'hit', sessionId:'target', title:'Archived title', kind, ...(kind === 'message' ? {seq:7} : {}), archived:true}]});
    await h.search(); assert.match(h.text, /已归档/); h.click(h.result());
    assert.match(h.text, /此会话已归档/); assert.ok(h.result()); assert.equal(h.calls.length, 0);
    h.key('Enter'); assert.equal(h.calls.length, 0, 'search Enter never confirms recovery');
    h.click(h.button('取消')); assert.ok(h.result()); assert.equal(h.button('恢复并打开'), undefined); assert.equal(h.calls.length, 0);
    h.click(h.result()); h.key('Escape'); assert.ok(h.tree); assert.equal(h.button('恢复并打开'), undefined);
    h.key('Escape'); assert.equal(h.tree, null);
  }
});

test('live archive membership overrides stale result flags in both directions', async () => {
  const h = harness({rows:[{id:'hit', sessionId:'target', title:'Stale active', kind:'title', archived:false}], archive:[]});
  await h.search(); h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:['target']});
  h.click(h.result()); assert.ok(h.button('恢复并打开')); assert.equal(h.calls.length, 0);
  h.click(h.button('取消')); h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]});
  h.click(h.result()); assert.deepEqual(h.calls.slice(0, 2), [['open','target'], ['panel',null]]);
  const staleArchived = harness({archive:[]}); await staleArchived.search(); staleArchived.click(staleArchived.result());
  assert.equal(staleArchived.calls.filter(call => call[0] === 'unarchive').length, 0); assert.equal(staleArchived.calls[0][0], 'open');
});

test('confirmation alone restores once and awaits reconciliation before native exact-message navigation', async () => {
  const done = deferred(); const h = harness({recovery:() => done.promise}); await h.search(); h.click(h.result());
  const confirm = h.button('恢复并打开'); confirm.props.onClick(); confirm.props.onClick(); h.render();
  h.result().props.onClick(); h.render(); assert.deepEqual(h.calls, [['unarchive','target']]);
  assert.ok(h.button('正在恢复…').props.disabled); assert.ok(h.result());
  h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}); await h.tick();
  assert.deepEqual(h.calls, [['unarchive','target']], 'local echo is insufficient while recovery promise is pending');
  done.resolve(); await h.tick(); assert.deepEqual(h.calls.slice(0, 4), [['unarchive','target'], ['open','target'], ['panel',null], ['retain','target','gateway']]);
  assert.equal(h.tree, null);
});

for (const scenario of ['rejection', 'missing API', 'unconfirmed recovery', 'unknown after recovery']) {
  test(scenario + ' reports a recoverable error without opening or clearing results', async () => {
    const h = harness({missingAPI:scenario === 'missing API', recovery:async (_, store) => {
      if (scenario === 'rejection') throw new Error('denied');
      if (scenario === 'unknown after recovery') store.set({phase:'pending', state:'loading', archivedSessionIds:[]});
    }});
    await h.search(); h.click(h.result()); h.click(h.button('恢复并打开')); await h.tick();
    assert.ok(h.result()); assert.ok(h.find(node => node.props.role === 'alert')); assert.match(h.text, /恢复失败/);
    assert.equal(h.calls.some(call => call[0] === 'open'), false);
  });
}
for (const scenario of ['pending', 'loading', 'error', 'missing store', 'missing membership']) {
  test(scenario + ' archive state fails closed with explicit error', async () => {
    const h = harness({phase:scenario === 'pending' ? 'pending' : 'ready', state:scenario === 'error' ? 'error' : scenario === 'loading' ? 'loading' : 'idle', missingStore:scenario === 'missing store'});
    await h.search(); if (scenario === 'missing membership') h.workspaces.set({phase:'ready', state:'idle'});
    h.click(h.result()); assert.match(h.text, /无法确认会话归档状态/); assert.ok(h.result()); assert.equal(h.calls.length, 0);
  });
}
for (const reason of ['cancel', 'Escape', 'close', 'query', 'workspace', 'archived filter', 'tab', 'unmount', 'dispose']) {
  test('late restore success after ' + reason + ' never navigates or rearchives', async () => {
    const done = deferred(); const h = harness({recovery:() => done.promise}); await h.search(); h.click(h.result()); h.click(h.button('恢复并打开'));
    if (reason === 'cancel') h.click(h.button('取消'));
    else if (reason === 'Escape') h.key('Escape');
    else if (reason === 'close') h.click(h.find(node => node.props['aria-label'] === '关闭 DeepSearch'));
    else if (reason === 'query') h.input().props.onChange({target:{value:'changed'}});
    else if (reason === 'workspace') h.find(node => node.props['aria-label'] === '工作区范围').props.onChange({target:{value:'different'}});
    else if (reason === 'archived filter') h.find(node => node.props.type === 'checkbox').props.onChange({target:{checked:true}});
    else if (reason === 'tab') h.click(h.button('项目'));
    else if (reason === 'unmount') h.unmount();
    else h.dispose();
    h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}); done.resolve(); await h.tick();
    assert.deepEqual(h.calls, [['unarchive','target']]);
  });
}

test('bounded recovery timeout keeps results and ignores later success', async () => {
  const done = deferred(); const h = harness({recovery:() => done.promise}); await h.search(); h.click(h.result()); h.click(h.button('恢复并打开'));
  h.expire(15000); await h.tick(); assert.match(h.text, /恢复超时.*刷新归档状态/); assert.ok(h.result());
  h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}); done.resolve(); await h.tick();
  assert.deepEqual(h.calls, [['unarchive','target']]);
});

for (const reason of ['cancel', 'timeout']) {
  test('reconfirmation after ' + reason + ' shares a still-pending host recovery', async () => {
    const done = deferred(), h = harness({recovery:() => done.promise}); await h.search(); h.click(h.result()); h.click(h.button('恢复并打开'));
    if (reason === 'cancel') h.click(h.button('取消')); else {h.expire(15000); await h.tick(); h.click(h.button('取消'));}
    h.click(h.result()); h.click(h.button('恢复并打开')); assert.deepEqual(h.calls, [['unarchive','target']]);
    h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}); done.resolve(); await h.tick();
    assert.equal(h.calls.filter(call => call[0] === 'open').length, 1);
  });
}

test('cancel and reselect cannot navigate through an optimistic local unarchive echo', async () => {
  const done = deferred(), h = harness({recovery:() => done.promise}); await h.search(); h.click(h.result()); h.click(h.button('恢复并打开'));
  h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}); h.click(h.button('取消')); h.click(h.result());
  assert.match(h.text, /恢复请求仍在进行/); assert.deepEqual(h.calls, [['unarchive','target']]);
  done.resolve(); await h.tick(); assert.deepEqual(h.calls, [['unarchive','target']], 'settlement alone cannot navigate cancelled selection');
  h.click(h.result()); assert.equal(h.calls.filter(call => call[0] === 'open').length, 1);
});

test('plain title recovery opens native session without retaining message history', async () => {
  const h = harness({rows:[{id:'title', sessionId:'target', title:'Archived title', kind:'title', archived:true}]});
  await h.search(); h.click(h.result()); h.click(h.button('恢复并打开')); await h.tick();
  assert.deepEqual(h.calls, [['unarchive','target'], ['open','target'], ['panel',null]]); assert.equal(h.tree, null);
});

test('external restoration before confirmation does not submit redundant recovery', async () => {
  const h = harness(); await h.search(); h.click(h.result());
  h.workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]});
  h.click(h.button('恢复并打开')); await h.tick();
  assert.equal(h.calls.some(call => call[0] === 'unarchive'), false); assert.equal(h.calls[0][0], 'open');
});

test('normal active message selection preserves native navigation without recovery', async () => {
  const h = harness({archive:[], rows:[{id:'active', sessionId:'target', title:'Active', kind:'message', seq:7, archived:false}]});
  await h.search(); assert.doesNotMatch(h.text, /已归档/); h.click(h.result()); await h.tick();
  assert.deepEqual(h.calls.slice(0, 3), [['open','target'], ['panel',null], ['retain','target','gateway']]);
  assert.ok(h.plugin.inject.includes('workspaces')); assert.equal(source.includes('window.confirm'), false); assert.equal(source.includes('confirm('), false);
});
