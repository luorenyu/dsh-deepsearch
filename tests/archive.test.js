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
  archive = ['target'], phase = 'ready', state = 'idle', recovery, missingAPI = false, missingStore = false,
  projects = [], catalogSessions = [], startSession, missingStart = false, nativeNavigation = false,
  storageSeed = {}, storageMap = new Map(), storage: suppliedStorage, exposeEvents = false} = {}) {
  let plugin, Overlay, tree, cursor = 0, dirty = false, mounted = true, timerId = 0, clock = 0;
  const hooks = [], effects = [], stores = [], timers = new Map(), windowEvents = new Map(), disposers = [], calls = [], scrolls = [], requests = [], focuses = [];
  const binding = observable({key:'old'}), panel = observable({activePanelId:null});
  const workspaces = observable({phase, state, archivedSessionIds:archive});
  const session = observable({loadingOlder:false, hasMore:false}); session.loadThrough = async () => {};
  // DSH LayoutController.selectPanel aborts a pending beginNavigation signal.
  let navigation = new AbortController();
  const creation = deferred(), selected = {workspaceId:null};
  const layout = {panelInfo:panel,
    beginNavigation() {navigation.abort(); navigation = new AbortController(); return navigation.signal;},
    selectPanel(id) {navigation.abort(); calls.push(['panel', id]); panel.set({activePanelId:id});}};
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
    uiWorkspace: {startSession: missingStart ? undefined : (...args) => {
      calls.push(['start', ...args]); startSession?.(...args);
      if (nativeNavigation) {
        const signal = layout.beginNavigation();
        // Native startSession returns void; openWorkspace waits for connectBlank.
        void creation.promise.then(() => {
          if (signal.aborted) return;
          selected.workspaceId = args[0]; binding.set({key:'blank-' + args[0]});
          layout.selectPanel(null);
        });
      }
    },
      openSession(id) {calls.push(['open', id]); binding.set({key:id});},
      unarchiveSession: missingAPI ? undefined : id => {calls.push(['unarchive', id]); return recovery ? recovery(id, workspaces) : Promise.resolve().then(() => workspaces.set({phase:'ready', state:'idle', archivedSessionIds:[]}));}},
    uiSession: {adapter:{current:binding}},
    sessions: {list:observable({byId:{}}), retain(id, options) {calls.push(['retain', id, options.source]); return {ready:Promise.resolve(), binding:{session, eventSource:{getSnapshot:() => ({entries:[{type:'event', event:{seq:7}}]})}}, release() {calls.push(['release', id]);}};}},
    layout,
    effect(fn) {disposers.push(fn());},
    slots: {inject(name, fn) {fn(); return () => {};}, register(options, component) {if (options.name === 'shell.overlay') Overlay = component;}},
  };
  const document = {baseURI:'http://localhost/', activeElement:null, addEventListener() {}, removeEventListener() {}};
  for (const [key, value] of Object.entries(storageSeed)) storageMap.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  const storage = suppliedStorage || {
    getItem:key => storageMap.has(key) ? storageMap.get(key) : null,
    setItem:(key, value) => storageMap.set(key, String(value)),
    removeItem:key => storageMap.delete(key),
  };
  const dispatch = (name, event) => {for (const listener of [...(windowEvents.get(name) || [])]) listener(event); render();};
  const window = {localStorage:storage, addEventListener(name, fn) {if (!windowEvents.has(name)) windowEvents.set(name, new Set()); windowEvents.get(name).add(fn);},
    removeEventListener(name, fn) {windowEvents.get(name)?.delete(fn);},
    __ModuleLoader__:{load(definition) {plugin = definition.factory(name => {
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return {StateDot: () => null};
      assert.equal(name, 'react'); return React;
    });}}};
  vm.runInNewContext(source, {window, document, AbortController, AbortSignal, URL, React,
    setTimeout(fn, delay) {const id = ++timerId; timers.set(id, {fn, delay, due:clock + delay}); return id;}, clearTimeout:id => timers.delete(id),
    fetch: async (url, options = {}) => {
      const parsed = new URL(String(url)), body = options.body ? JSON.parse(options.body) : null;
      requests.push({url:parsed, method:options.method, body});
      return {ok:true, text:async () => JSON.stringify(parsed.pathname.endsWith('/catalog') ? {sessions:catalogSessions, workspaces:projects} : {items:rows, cursor:null, scanned:1, totalSessions:1, warnings:[]})};
    },
  });
  plugin.apply(ctx);
  function nodes(node = tree) {if (!node || typeof node !== 'object') return []; return [node, ...node.children.flatMap(child => child && typeof child === 'object' ? nodes(child) : [])];}
  function render() {
    if (!mounted) return;
    let turns = 0;
    do {
      assert.ok(turns++ < 30, 'hooks settle'); cursor = 0; pending = []; dirty = false; tree = Overlay();
      for (const node of nodes()) if (node.props.ref) node.props.ref.current ||= {focus() {focuses.push(node.props['aria-label'] || node.tag);}, contains:() => true,
        querySelector: selector => ['listbox','grid'].includes(node.props.role) ? {scrollIntoView: options => scrolls.push({selector, options})} : null, querySelectorAll:() => []};
      for (const {i, callback, deps} of pending) {effects[i]?.cleanup?.(); effects[i] = {deps, cleanup:callback()};}
    } while (dirty);
  }
  const find = predicate => nodes().find(predicate);
  const button = label => find(node => node.tag === 'button' && node.children.includes(label));
  const input = () => find(node => node.props['aria-label'] === '搜索会话正文');
  const click = node => {assert.ok(node, 'target exists'); node.props.onClick({preventDefault() {}, stopPropagation() {}}); render();};
  const checkbox = label => {const parent = find(node => node.tag === 'label' && nodeText(node).trim() === label); return parent && nodes(parent).find(node => node.tag === 'input' && node.props.type === 'checkbox');};
  const change = value => {input().props.onChange({target:{value}}); render();};
  const tick = async () => {for (let i = 0; i < 15; i++) {await Promise.resolve(); if (dirty) render();}};
  const expire = delay => {for (const [id, timer] of [...timers]) if (timer.delay === delay) {timers.delete(id); timer.fn();} render();};
  function advance(milliseconds) {
    const end = clock + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next; clock = timer.due; timers.delete(id); timer.fn(); render();
    }
    clock = end; render();
  }
  function key(key) {tree.props.onKeyDown({key, target:input().props.ref.current, preventDefault() {}, stopPropagation() {}}); render();}
  async function open() {dispatch('keydown', {key:'k', metaKey:true, shiftKey:true, preventDefault() {}, stopPropagation() {}}); await tick();}
  async function search(query = 'Archived') {await open();
    input().props.onChange({target:{value:query}}); render(); expire(220); await tick();}
  render();
  return {ctx, calls, scrolls, requests, focuses, plugin, workspaces, creation, selected, tick, expire, advance, key, open, search, render, nodes, find, button, input, click, checkbox, change, storage, storageMap,
    ...(exposeEvents ? {dispatch, windowEvents} : {}),
    pendingTimers:delay => [...timers.values()].filter(timer => timer.delay === delay).length,
    get tree() {return tree;}, get text() {return nodes().flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ');},
    result:() => find(node => node.props.role === 'option'),
    unmount() {mounted = false; for (const effect of effects) effect?.cleanup?.(); for (const unsubscribe of stores) unsubscribe?.();},
    dispose() {for (const dispose of disposers) dispose?.(); render();},
  };
}

for (const action of ['click', 'Enter']) test('project ' + action + ' allows delayed native navigation to commit instead of cancelling it', async () => {
  const h = harness({rows:[], archive:[], projects:[{id:'project-id',title:'Archived workspace'}], nativeNavigation:true});
  await h.search();
  if (action === 'click') h.click(h.result()); else h.key('Enter');
  assert.equal(h.tree, null, 'search closes independently of host navigation');
  assert.equal(h.selected.workspaceId, null, 'blank creation is still pending');
  h.creation.resolve(); await h.tick();
  assert.equal(h.selected.workspaceId, 'project-id', 'native navigation reaches the target workspace');
  assert.deepEqual(h.calls, [['start', 'project-id'], ['panel', null]], 'only native completion reveals the panel');
});

for (const action of ['click', 'Enter']) test('project result ' + action + ' opens native new conversation without sending query or replacing draft', async () => {
  const h = harness({rows:[], archive:[], projects:[{id:'project-id', title:'Archived workspace'}]});
  await h.search();
  assert.match(h.text, /工作区 · 点击或回车新建会话/);
  if (action === 'click') h.click(h.result()); else h.key('Enter');
  assert.deepEqual(h.calls, [['start', 'project-id']], 'plugin leaves panel reveal to native startSession');
  assert.equal(h.tree, null, 'overlay closes after native start');
});

test('project scope dropdown still filters without creating a session', async () => {
  const h = harness({rows:[], archive:[], projects:[{id:'first',title:'Archived one'}, {id:'second',title:'Archived two'}]});
  await h.search();
  h.find(node => node.props['aria-label'] === '工作区范围').props.onChange({target:{value:'second'}}); h.render(); await h.tick();
  assert.equal(h.find(node => node.props['aria-label'] === '工作区范围').props.value, 'second');
  assert.deepEqual(h.calls, []);
});

for (const unsupported of [false, true]) test('project native start failure keeps search and shows an error: unsupported=' + unsupported, async () => {
  const h = harness({rows:[], archive:[], projects:[{id:'project-id',title:'Archived workspace'}], missingStart:unsupported,
    startSession:() => {throw new Error('workspace unavailable');}});
  await h.search(); h.click(h.result());
  assert.ok(h.tree, 'search stays open');
  assert.equal(h.input().props.value, 'Archived');
  assert.match(h.find(node => node.props.role === 'alert').children.join(' '), unsupported ? /不支持.*新建会话/ : /workspace unavailable/);
  assert.ok(!h.calls.some(call => call[0] === 'panel'));
});

test('IME confirmation does not activate a project result', async () => {
  const h = harness({rows:[], archive:[], projects:[{id:'project-id',title:'Archived workspace'}]});
  await h.search();
  h.tree.props.onKeyDown({key:'Enter',isComposing:true,target:h.input().props.ref.current}); h.render();
  assert.deepEqual(h.calls, []);
  assert.ok(h.tree);
});

test('mouse hover only highlights results; only keyboard navigation scrolls, including wraparound', async () => {
  const h = harness({archive: [], rows: Array.from({length: 12}, (_, i) => ({id: 'hit-' + i, sessionId: 'target', title: 'Title ' + i, kind: 'title', archived: false}))});
  await h.search();
  const results = () => h.nodes().filter(node => node.props.role === 'option');
  const selected = () => results().findIndex(node => node.props['aria-selected']);
  assert.equal(h.scrolls.length, 0);
  for (const i of [11, 0, 8, 2]) {results()[i].props.onMouseEnter(); h.render(); assert.equal(selected(), i);}
  assert.equal(h.scrolls.length, 0, 'hover never requests scrollIntoView');
  h.key('ArrowDown'); assert.equal(selected(), 3);
  assert.equal(h.scrolls.at(-1).selector, '#deepsearch-result-3');
  assert.equal(h.scrolls.at(-1).options.block, 'nearest');
  results()[0].props.onMouseEnter(); h.render(); assert.equal(h.scrolls.length, 1);
  h.key('ArrowUp'); assert.equal(selected(), 11);
  assert.equal(h.scrolls.at(-1).selector, '#deepsearch-result-11');
  h.key('ArrowDown'); assert.equal(selected(), 0);
  assert.equal(h.scrolls.at(-1).selector, '#deepsearch-result-0');
  const count = h.scrolls.length;
  h.input().props.onChange({target: {value: 'new query'}}); h.render();
  h.key('ArrowDown'); assert.equal(h.scrolls.length, count, 'empty results and search reset do not scroll');
  h.dispose();
});

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
    else if (reason === 'archived filter') h.checkbox('含归档').props.onChange({target:{checked:true}});
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

const nodeText = node => !node || typeof node !== 'object' ? (typeof node === 'string' ? node : '') : node.children.map(nodeText).join('');
const resultMetadata = h => h.nodes().filter(node => node.props.className === 'deepsearch-meta').map(nodeText);
const localMinute = value => {
  const date = new Date(value), pad = number => String(number).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
};

test('archive inclusion defaults on for catalog URL and outgoing search body', async () => {
  const h = harness(); await h.search();
  assert.equal(h.checkbox('含归档').props.checked, true);
  const catalog = h.requests.find(request => request.url.pathname.endsWith('/catalog'));
  assert.ok(catalog, 'opening the actual Overlay requests its catalog');
  assert.equal(catalog.method, 'GET');
  assert.equal(catalog.url.searchParams.get('includeArchived'), 'true');
  const search = h.requests.find(request => request.url.pathname.endsWith('/search'));
  assert.equal(search.method, 'POST');
  assert.equal(search.body.includeArchived, true);
  assert.equal(search.body.query, 'Archived');
});

test('unchecking archive inclusion filters the full recent catalog locally and sends false to search', async () => {
  const h = harness({catalogSessions:[
    {id:'archived',title:'Archived recent',archived:true},
    {id:'active',title:'Active recent',archived:false},
  ]});
  await h.open();
  assert.deepEqual(h.nodes().filter(node => node.props.role === 'option').map(node => nodeText(node).includes('Archived recent')), [true, false]);
  const checkbox = () => h.checkbox('含归档');
  checkbox().props.onChange({target:{checked:false}}); h.render(); await h.tick();
  assert.equal(checkbox().props.checked, false);
  assert.deepEqual(h.nodes().filter(node => node.props.role === 'option').map(node => nodeText(node).includes('Active recent')), [true], 'catalog fixture deliberately retains archived rows so client filtering is exercised');
  const catalog = h.requests.filter(request => request.url.pathname.endsWith('/catalog')).at(-1);
  assert.equal(catalog.url.searchParams.get('includeArchived'), 'true', 'catalog keeps a complete snapshot; checkbox filtering is local');
  h.input().props.onChange({target:{value:'needle'}}); h.render(); h.expire(220); await h.tick();
  assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).at(-1).body.includeArchived, false);
  checkbox().props.onChange({target:{checked:true}}); h.render(); h.expire(220); await h.tick();
  assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).at(-1).body.includeArchived, true);
  h.input().props.onChange({target:{value:''}}); h.render();
  assert.equal(h.nodes().filter(node => node.props.role === 'option').length, 2, 'rechecking restores archived recent rows');
});

test('empty-query recent metadata resolves project by workspaceId and displays local last-updated minute', async () => {
  const updatedAt = Date.parse('2026-11-15T19:04:38.000Z');
  const h = harness({archive:[], projects:[{id:'other',title:'Wrong project'}, {id:'project',title:'Resolved project'}], catalogSessions:[
    {id:'recent',title:'Recent session',workspaceId:'project',updatedAt,time:'2001-01-01T00:00:00Z'},
  ]});
  await h.open();
  assert.deepEqual(resultMetadata(h), ['Resolved project · ' + localMinute(updatedAt)]);
  assert.doesNotMatch(resultMetadata(h).join(' '), /会话标题|2001\/01\/01/);
  assert.equal(h.requests.some(request => request.url.pathname.endsWith('/search')), false, 'empty query uses the catalog rather than body search');
});

for (const [label, catalogUpdatedAt] of [['legacy catalog without timestamp',undefined], ['stale catalog timestamp',Date.parse('2026-10-01T08:15:00Z')]]) {
  test('recent timestamp prefers live sessions and follows subsequent updates: ' + label, async () => {
    const liveUpdatedAt = Date.parse('2026-11-15T19:04:38Z'), nextUpdatedAt = Date.parse('2026-11-16T02:09:12Z');
    const h = harness({archive:[], projects:[{id:'project',title:'Live project'}], catalogSessions:[
      {id:'recent',title:'Recent session',workspaceId:'project',updatedAt:catalogUpdatedAt},
    ]});
    h.ctx.sessions.list.set({byId:{unrelated:{id:'unrelated',updatedAt:nextUpdatedAt}, recent:{id:'recent',updatedAt:liveUpdatedAt}}});
    await h.open();
    assert.deepEqual(resultMetadata(h), ['Live project · ' + localMinute(liveUpdatedAt)], 'match live row by session id, not object order or stale catalog value');
    const catalogRequests = h.requests.filter(request => request.url.pathname.endsWith('/catalog')).length;
    h.ctx.sessions.list.set({byId:{recent:{id:'recent',updatedAt:nextUpdatedAt}}});
    await h.tick();
    assert.deepEqual(resultMetadata(h), ['Live project · ' + localMinute(nextUpdatedAt)], 'subscription refreshes the visible recent timestamp without reopening');
    assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/catalog')).length, catalogRequests, 'live timestamp changes need no catalog refetch');
    h.ctx.sessions.list.set({byId:{recent:{id:'recent'}}}); await h.tick();
    assert.deepEqual(resultMetadata(h), ['Live project · ' + (catalogUpdatedAt ? localMinute(catalogUpdatedAt) : '时间未知')], 'missing live timestamp falls back to catalog metadata');
  });
}

for (const [label, updatedAt] of [['missing',undefined], ['null',null], ['zero',0], ['negative',-1], ['empty',''], ['invalid','not-a-date'], ['invalid calendar','2026-02-30T10:00:00Z'], ['epoch string','1970-01-01T00:00:00Z'], ['pre-epoch string','1969-12-31T23:59:59Z']]) {
  test('recent metadata uses unknown project/time without epoch for ' + label + ' updatedAt', async () => {
    const h = harness({archive:[], catalogSessions:[{id:'recent',title:'Recent session',workspaceId:'deleted-project',updatedAt}]});
    await h.open();
    assert.deepEqual(resultMetadata(h), ['未分配项目 · 时间未知']);
    assert.doesNotMatch(resultMetadata(h).join(' '), /会话标题|1970|1969/);
  });
}

test('search hit metadata still uses message time and role instead of session last update', async () => {
  const time = '2026-10-18T18:09:55Z';
  const h = harness({archive:[], rows:[
    {id:'user',sessionId:'target',title:'A hit',kind:'message',role:'user',workspaceTitle:'Hit project',time,updatedAt:Date.parse('2026-11-15T19:04:00Z')},
    {id:'assistant',sessionId:'target',title:'A reply',kind:'message',role:'assistant',workspaceTitle:'Hit project',time:'not-a-date',updatedAt:Date.parse(time)},
    {id:'title',sessionId:'target',title:'A title',kind:'title',workspaceTitle:'Hit project',time},
  ]});
  await h.search('needle');
  assert.deepEqual(resultMetadata(h), ['你 · Hit project · ' + localMinute(time), '助手 · Hit project', '会话标题 · Hit project · ' + localMinute(time)]);
});

test('header settings and escape buttons share explicit equal-height centered styling', async () => {
  const h = harness(); await h.open();
  const header = h.find(node => node.tag === 'header' && node.props.className === 'deepsearch-search');
  const buttons = header.children.filter(child => child?.tag === 'button');
  assert.deepEqual(buttons.map(nodeText), ['设置', 'esc']);
  assert.deepEqual(buttons.map(node => node.props.className), ['deepsearch-escape', 'deepsearch-escape']);
  const stylesheet = h.nodes().filter(node => node.tag === 'style').map(nodeText).join(' ');
  const rule = stylesheet.match(/\.deepsearch-escape\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'shared header button rule is present in the actual rendered stylesheet');
  for (const declaration of ['box-sizing:border-box', 'height:22px', 'line-height:16px!important', 'display:inline-flex', 'align-items:center', 'justify-content:center']) {
    assert.ok(rule.split(';').includes(declaration), 'header button rule includes ' + declaration);
  }
  h.dispose();
});

test('appearance reset is an accessible icon button immediately after blur in its controls row', async () => {
  const h = harness(); await h.open(); h.click(h.button('设置'));
  const controls = () => h.find(node => (node.props.className || '').split(' ').includes('deepsearch-appearance-controls'));
  assert.ok(controls(), 'appearance fields share their compact controls row');
  const children = controls().children.filter(child => child && typeof child === 'object');
  const blurIndex = children.findIndex(child => child.tag === 'label' && nodeText(child).startsWith('模糊 '));
  assert.ok(blurIndex >= 0);
  const reset = children[blurIndex + 1];
  assert.equal(reset?.tag, 'button');
  assert.equal(reset.props.type, 'button');
  assert.equal(reset.props['aria-label'], '恢复默认');
  assert.equal(reset.props.title, '恢复默认');
  assert.equal(nodeText(reset), '', 'reset uses an icon, not a long text button');
  const svg = h.nodes(reset).find(node => node.tag === 'svg');
  assert.ok(svg, 'reset contains an actual SVG icon');
  assert.equal(svg.props['aria-hidden'], true);
  const blur = children[blurIndex].children.find(child => child?.tag === 'input');
  blur.props.onChange({target:{value:'7'}}); h.render();
  assert.match(nodeText(controls()), /模糊 7px/);
  h.click(h.find(node => node.tag === 'button' && node.props['aria-label'] === '恢复默认'));
  assert.match(nodeText(controls()), /模糊 18px/);
  assert.equal(h.tree.props['data-appearance'], 'glass');
});

test('shortcut help is concise while official-write and uninstall warnings remain accessible', async () => {
  const h = harness(); await h.open(); h.click(h.button('设置'));
  const help = h.find(node => node.props.id === 'deepsearch-shortcut-help');
  assert.ok(help);
  assert.equal(nodeText(help), '替代原生搜索，关闭恢复原绑定；⌘⇧K 仍可用。');
  const toggle = h.find(node => node.props.role === 'switch' && node.props['aria-labelledby'] === 'deepsearch-shortcut-label');
  assert.ok(toggle);
  const descriptionIds = (toggle.props['aria-describedby'] || '').split(/\s+/).filter(Boolean);
  assert.ok(descriptionIds.length, 'shortcut switch has an accessible description');
  const descriptions = descriptionIds.map(id => {const node = h.find(node => node.props.id === id); assert.ok(node, 'description target ' + id + ' exists'); return node;});
  const accessibleWarning = [help.props.title, toggle.props.title, ...descriptions.map(node => nodeText(node) + ' ' + (node.props.title || ''))].filter(Boolean).join(' ');
  assert.match(accessibleWarning, /写入 DSH 官方快捷键配置/);
  assert.match(accessibleWarning, /卸载插件前请先关闭接管/);
  assert.match(accessibleWarning, /关闭恢复原绑定/);
});

const HISTORY_KEY = 'dsh-deepsearch.search-history.v1';
const historySeed = (entries = [], defaultHistory = false) => ({[HISTORY_KEY]:{defaultHistory, entries:entries.map((query, i) => ({query, time:2000 - i}))}});
const savedHistory = h => JSON.parse(h.storage.getItem(HISTORY_KEY) || '{"defaultHistory":false,"entries":[]}');
const savedQueries = h => savedHistory(h).entries.map(entry => entry.query);
const historyRows = h => h.nodes().filter(node => node.props.role === 'row');
const historyTab = (h, label) => h.find(node => node.props.role === 'tab' && nodeText(node) === label);
function toggleDefaultHistory(h, checked) {
  const checkbox = h.checkbox('默认历史'); assert.ok(checkbox, 'default-history checkbox exists');
  checkbox.props.onChange({target:{checked}}); h.render();
}

test('history defaults off; empty-view tabs and preference appear immediately before archive inclusion', async () => {
  const h = harness({storageSeed:historySeed(['old search']), catalogSessions:[{id:'recent', title:'Recent session'}]});
  await h.open();
  assert.equal(h.checkbox('默认历史').props.checked, false);
  assert.equal(h.checkbox('含归档').props.checked, true, 'new checkbox does not change archive default');
  assert.equal(historyTab(h, '最近对话').props['aria-selected'], true);
  assert.equal(historyTab(h, '搜索历史').props['aria-selected'], false);
  assert.match(nodeText(h.result()), /Recent session/);
  const options = h.find(node => node.children.some(child => child?.tag === 'label' && nodeText(child) === '默认历史') && node.children.some(child => child?.tag === 'label' && nodeText(child) === '含归档'));
  assert.ok(options, 'both preferences are in one options row');
  const labels = options.children.filter(child => child?.tag === 'label').map(nodeText);
  assert.equal(labels[labels.indexOf('默认历史') + 1], '含归档');
  h.click(historyTab(h, '搜索历史'));
  assert.equal(historyTab(h, '搜索历史').props['aria-selected'], true);
  assert.match(nodeText(historyRows(h)[0]), /old search/);
  h.click(historyTab(h, '最近对话'));
  assert.match(nodeText(h.result()), /Recent session/);
  assert.deepEqual(h.calls, []);
});

const emptyViewTabs = h => h.nodes().filter(node => node.props.role === 'tab' && ['搜索历史', '最近对话'].includes(nodeText(node)));
const expectedEmptyViewOrder = defaultHistory => defaultHistory ? ['搜索历史', '最近对话'] : ['最近对话', '搜索历史'];
function assertEmptyView(h, selectedLabel) {
  assert.deepEqual(emptyViewTabs(h).filter(node => node.props['aria-selected']).map(nodeText), [selectedLabel]);
  if (selectedLabel === '搜索历史') {
    assert.deepEqual(historyRows(h).map(nodeText).map(text => text.includes('remembered search')), [true]);
    assert.equal(h.result(), undefined, 'recent conversations are not rendered over selected history');
  } else {
    assert.equal(historyRows(h).length, 0, 'history rows are not rendered over selected recent conversations');
    assert.match(nodeText(h.result()), /Recent conversation/);
  }
}

for (const defaultHistory of [true, false]) {
  test('empty-view tab order and initial selection follow default-history=' + defaultHistory, async () => {
    const h = harness({storageSeed:historySeed(['remembered search'], defaultHistory),
      catalogSessions:[{id:'recent', title:'Recent conversation'}]});
    await h.open();
    assert.equal(h.checkbox('默认历史').props.checked, defaultHistory);
    assert.equal(h.checkbox('默认搜索历史'), undefined, 'old preference label is no longer rendered');
    assert.deepEqual(emptyViewTabs(h).map(nodeText), expectedEmptyViewOrder(defaultHistory));
    assertEmptyView(h, expectedEmptyViewOrder(defaultHistory)[0]);
    h.dispose();
  });

  for (const selectedLabel of ['搜索历史', '最近对话']) {
    test('default-history ' + defaultHistory + ' → ' + !defaultHistory + ' reorders immediately while preserving ' + selectedLabel + ', then reopens and reloads on the first tab', async () => {
      const storageMap = new Map(), catalogSessions = [{id:'recent', title:'Recent conversation'}];
      const h = harness({storageMap, storageSeed:historySeed(['remembered search'], defaultHistory), catalogSessions});
      await h.open(); h.click(historyTab(h, selectedLabel));
      assertEmptyView(h, selectedLabel);
      const storedEntries = savedHistory(h).entries;
      toggleDefaultHistory(h, !defaultHistory);
      assert.deepEqual(emptyViewTabs(h).map(nodeText), expectedEmptyViewOrder(!defaultHistory), 'checkbox change reorders without closing the overlay');
      assertEmptyView(h, selectedLabel);
      assert.equal(h.input().props.value, '', 'preference changes do not replay a query');
      assert.equal(savedHistory(h).defaultHistory, !defaultHistory);
      assert.deepEqual(savedHistory(h).entries, storedEntries, 'preference updates preserve stored search entries');
      assert.deepEqual([...storageMap.keys()], [HISTORY_KEY], 'persistence retains the original key without a replacement key');
      assert.deepEqual(h.calls, [], 'preference and tab changes do not navigate the host');

      const firstLabel = expectedEmptyViewOrder(!defaultHistory)[0];
      h.key('Escape'); await h.open();
      assert.deepEqual(emptyViewTabs(h).map(nodeText), expectedEmptyViewOrder(!defaultHistory));
      assertEmptyView(h, firstLabel);
      h.dispose();

      const refreshed = harness({storageMap, catalogSessions}); await refreshed.open();
      assert.equal(refreshed.checkbox('默认历史').props.checked, !defaultHistory, 'a fresh plugin instance restores the saved preference');
      assert.deepEqual(emptyViewTabs(refreshed).map(nodeText), expectedEmptyViewOrder(!defaultHistory));
      assertEmptyView(refreshed, firstLabel);
      assert.deepEqual(savedHistory(refreshed).entries, storedEntries);
      refreshed.dispose();
    });
  }
}

test('history records only the trimmed stable input after 1000ms, not the normal 220ms search debounce', async () => {
  const h = harness({archive:[]}); await h.open();
  h.change('  first query  '); h.advance(220); await h.tick();
  assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).at(-1).body.query, 'first query');
  assert.deepEqual(savedQueries(h), []);
  h.advance(779); assert.deepEqual(savedQueries(h), []);
  h.change('  second query  '); h.advance(999); await h.tick();
  assert.deepEqual(savedQueries(h), [], 'editing cancels the previous pending record');
  h.advance(1); assert.deepEqual(savedQueries(h), ['second query']);
  assert.ok(Number.isFinite(savedHistory(h).entries[0].time));
  h.change('   '); h.advance(2000); assert.deepEqual(savedQueries(h), ['second query']);
});

test('history exact dedup moves newest first, keeps case distinctions, and caps at 30', async () => {
  const h = harness({storageSeed:historySeed(Array.from({length:30}, (_, i) => 'query-' + i))});
  await h.open();
  h.change(' query-20 '); h.advance(1000);
  let queries = savedQueries(h);
  assert.equal(queries.length, 30); assert.equal(queries[0], 'query-20');
  assert.equal(queries.filter(query => query === 'query-20').length, 1);
  h.change('QUERY-20'); h.advance(1000);
  queries = savedQueries(h);
  assert.equal(queries.length, 30); assert.deepEqual(queries.slice(0, 2), ['QUERY-20', 'query-20']);
  assert.equal(queries.includes('query-29'), false, 'oldest is evicted');
});

test('history rejects overlong input but accepts the exact 256-character boundary', async () => {
  const h = harness(); await h.open();
  h.change('x'.repeat(257)); h.advance(1000); assert.deepEqual(savedQueries(h), []);
  h.change('x'.repeat(256)); h.advance(1000); assert.deepEqual(savedQueries(h), ['x'.repeat(256)]);
});

test('history IME composition cancels pending recording and starts a full delay after commit', async () => {
  const h = harness(); await h.open();
  h.change('pre-composition'); h.advance(900);
  h.input().props.onCompositionStart(); h.render();
  h.change('搜索中'); h.advance(2000); await h.tick();
  assert.deepEqual(savedQueries(h), [], 'neither stale input nor composing text is stored');
  const requestCount = h.requests.filter(request => request.url.pathname.endsWith('/search')).length;
  h.tree.props.onKeyDown({key:'Enter', isComposing:true, target:h.input().props.ref.current}); h.render();
  assert.deepEqual(h.calls, []);
  h.input().props.onCompositionEnd(); h.render();
  h.advance(220); await h.tick();
  assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).length, requestCount + 1);
  h.advance(779); assert.deepEqual(savedQueries(h), []);
  h.advance(1); assert.deepEqual(savedQueries(h), ['搜索中']);
});

for (const reason of ['Escape', 'close button', 'shortcut', 'unmount', 'dispose']) {
  test('history cancels pending recording on ' + reason, async () => {
    const h = harness(); await h.open(); h.change('do not save'); h.advance(999);
    if (reason === 'Escape') h.key('Escape');
    else if (reason === 'close button') h.click(h.find(node => node.props['aria-label'] === '关闭 DeepSearch'));
    else if (reason === 'shortcut') await h.open();
    else h[reason]();
    h.advance(2000); await h.tick();
    assert.deepEqual(savedQueries(h), []);
    assert.equal(h.pendingTimers(1000), 0);
    assert.deepEqual(h.calls, []);
  });
}

test('history preference persists across plugin instances and applies on every reopen, not only first mount', async () => {
  const storageMap = new Map();
  const h = harness({storageMap, storageSeed:historySeed(['remembered'])}); await h.open();
  toggleDefaultHistory(h, true);
  assert.equal(savedHistory(h).defaultHistory, true);
  for (let reopen = 0; reopen < 2; reopen++) {
    h.change('leftover query ' + reopen); h.expire(220); await h.tick();
    h.key('Escape'); await h.open();
    assert.equal(h.input().props.value, '', 'default history clears prior query each reopen');
    assert.equal(historyTab(h, '搜索历史').props['aria-selected'], true);
    assert.match(nodeText(historyRows(h)[0]), /remembered/);
  }
  const fresh = harness({storageMap}); await fresh.open();
  assert.equal(fresh.checkbox('默认历史').props.checked, true);
  assert.equal(historyTab(fresh, '搜索历史').props['aria-selected'], true);
  assert.match(nodeText(historyRows(fresh)[0]), /remembered/);
  toggleDefaultHistory(fresh, false); fresh.key('Escape'); await fresh.open();
  assert.equal(historyTab(fresh, '最近对话').props['aria-selected'], true);
  fresh.change('old query'); fresh.expire(220); await fresh.tick();
  fresh.key('Escape'); await fresh.open();
  assert.equal(fresh.input().props.value, '', 'default false also clears old query to reveal its chosen empty view');
  assert.equal(historyTab(fresh, '最近对话').props['aria-selected'], true);
  assert.equal(fresh.button('全部').props['aria-selected'], true, 'reopen returns to the all-results tab');
});

for (const action of ['click', 'Enter']) {
  test('history ' + action + ' replays into input and normal debounced search without native navigation', async () => {
    const h = harness({archive:[], storageSeed:historySeed(['first term', 'second term'], true)}); await h.open();
    let query = 'first term';
    if (action === 'click') h.click(h.find(node => node.props['aria-label'] === '重新搜索：first term'));
    else {
      h.tree.props.onKeyDown({key:'Enter', isComposing:true, target:h.input().props.ref.current}); h.render();
      assert.equal(h.input().props.value, '', 'IME confirmation does not replay history');
      h.key('ArrowUp');
      assert.equal(historyRows(h).findIndex(node => node.props['aria-selected']), 1, 'history selection wraps backwards');
      assert.equal(h.input().props['aria-activedescendant'], historyRows(h)[1].props.id);
      h.key('ArrowDown');
      assert.equal(historyRows(h).findIndex(node => node.props['aria-selected']), 0, 'history selection wraps forwards');
      h.key('ArrowDown'); query = 'second term'; h.key('Enter');
    }
    assert.ok(h.tree, 'replay keeps the overlay open'); assert.equal(h.input().props.value, query);
    assert.deepEqual(h.calls, [], 'replay never opens a session or starts a project');
    assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).length, 0);
    h.advance(219); await h.tick();
    assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).length, 0);
    h.advance(1); await h.tick();
    assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).at(-1).body.query, query);
    assert.deepEqual(h.calls, []);
  });
}

test('history remove and clear persist without replay, host navigation, or nested buttons', async () => {
  const storageMap = new Map();
  const h = harness({storageMap, storageSeed:historySeed(['one', 'two'], true)}); await h.open();
  assert.ok(h.find(node => node.props.role === 'grid'), 'history actions use an interactive grid rather than listbox options');
  assert.equal(h.input().props['aria-haspopup'], 'grid');
  for (const row of historyRows(h)) {
    assert.equal(row.tag, 'div');
    assert.equal(row.children.filter(child => child?.props?.role === 'gridcell').length, 2);
    const buttons = h.nodes(row).filter(node => node.tag === 'button');
    assert.equal(buttons.length, 2, 'separate replay and removal controls');
    for (const button of buttons) assert.equal(h.nodes(button).filter(node => node.tag === 'button').length, 1, 'no nested button');
  }
  let focusCount = h.focuses.length;
  h.click(h.find(node => node.props['aria-label'] === '删除搜索历史：one'));
  assert.ok(h.focuses.length > focusCount); assert.equal(h.focuses.at(-1), '搜索会话正文', 'remove restores focus after unmounting its button');
  assert.equal(h.input().props.value, ''); assert.deepEqual(savedQueries(h), ['two']);
  assert.equal(historyRows(h).length, 1); assert.deepEqual(h.calls, []);
  focusCount = h.focuses.length; h.click(h.button('清空搜索历史'));
  assert.ok(h.focuses.length > focusCount); assert.equal(h.focuses.at(-1), '搜索会话正文', 'clear restores focus after unmounting its button');
  assert.deepEqual(savedQueries(h), []); assert.equal(savedHistory(h).defaultHistory, true);
  assert.equal(historyRows(h).length, 0); assert.match(h.text, /暂无搜索历史/);
  h.advance(2000); await h.tick(); assert.deepEqual(savedQueries(h), []);
  assert.equal(h.requests.some(request => request.url.pathname.endsWith('/search')), false);
  const fresh = harness({storageMap}); await fresh.open();
  assert.equal(historyRows(fresh).length, 0); assert.equal(fresh.checkbox('默认历史').props.checked, true);
});

test('history storage events reload shared local state but ignore unrelated keys', async () => {
  const h = harness({storageSeed:historySeed(['initial'], true), exposeEvents:true}); await h.open();
  h.storage.setItem(HISTORY_KEY, JSON.stringify({defaultHistory:true, entries:[{query:'external update', time:3000}]}));
  h.dispatch('storage', {key:'unrelated', storageArea:h.storage});
  assert.match(nodeText(historyRows(h)[0]), /initial/);
  h.dispatch('storage', {key:HISTORY_KEY, storageArea:h.storage});
  assert.match(nodeText(historyRows(h)[0]), /external update/);
  h.storage.removeItem(HISTORY_KEY); h.dispatch('storage', {key:null, storageArea:h.storage});
  assert.equal(historyRows(h).length, 0); assert.equal(h.checkbox('默认历史').props.checked, false);
});

for (const failure of ['read', 'write']) {
  test('history storage ' + failure + ' failure shows a warning while in-memory history and searching still work', async () => {
    const h = harness({archive:[], storage:{
      getItem() {if (failure === 'read') throw new Error('SecurityError'); return null;},
      setItem() {throw new Error('QuotaExceededError');}, removeItem() {throw new Error('SecurityError');},
    }});
    await h.open();
    if (failure === 'read') assert.ok(h.nodes().some(node => ['status','alert'].includes(node.props.role) && /搜索历史/.test(nodeText(node)) && /读取|保存|存储|浏览器/.test(nodeText(node))), 'read error is visible');
    h.change('in memory'); h.advance(1000); await h.tick();
    assert.equal(h.requests.filter(request => request.url.pathname.endsWith('/search')).at(-1).body.query, 'in memory');
    assert.ok(h.nodes().some(node => ['status','alert'].includes(node.props.role) && /搜索历史/.test(nodeText(node)) && /读取|保存|存储|浏览器/.test(nodeText(node))), 'write error is visible');
    h.change(''); h.click(historyTab(h, '搜索历史'));
    assert.match(nodeText(historyRows(h)[0]), /in memory/);
    toggleDefaultHistory(h, true); h.key('Escape'); await h.open();
    assert.equal(historyTab(h, '搜索历史').props['aria-selected'], true, 'failed preference save still applies this session');
    assert.deepEqual(h.calls, []);
  });
}
