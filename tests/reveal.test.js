import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped helper, not a copy of its implementation or the module loader.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const first = source.indexOf('    const MAX_RESULTS');
const last = source.indexOf('    function selectedKeys', first);
assert.ok(first >= 0 && last > first, 'reveal helper extraction boundaries exist');
const helper = source.slice(first, last);

function store(initial) {
  let value = initial;
  const listeners = new Set();
  return {listeners, getSnapshot: () => value,
    subscribe(callback) {listeners.add(callback); return () => listeners.delete(callback);},
    set(next) {value = next; for (const callback of [...listeners]) callback();}};
}

function harness({dom = true, observerError = false, observer = true} = {}) {
  const timers = new Map(), events = new Map(), observers = [], rows = [], clicks = [], scrolls = [];
  let now = 0, timerId = 0, starts = 0;
  const old = {id:'old', blank:false, retainedBy:{mainView:1}};
  const sessions = store({byId:{old}});
  const target = {workspaceId:'target', path:'/projects/target', sessionIds:['blank']};
  const workspaces = store({phase:'ready', items:[target]});
  const panel = store({activePanelId:null});
  const body = {scrollTop:700, parentElement:null};
  const sidebar = {parentElement:body, overflowY:'auto', scrollHeight:1000, clientHeight:200,
    getAttribute:() => null, hasAttribute:() => false,
    getBoundingClientRect: () => ({top:100, bottom:300})};
  let sidebarTop = 30;
  Object.defineProperty(sidebar, 'scrollTop', {get:() => sidebarTop,
    set(value) {sidebarTop = value; scrolls.push(value);}});
  const conversation = {scrollTop:900};
  const document = {body,
    addEventListener(name, callback, capture) {assert.equal(capture, true); if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback);},
    removeEventListener(name, callback, capture) {assert.equal(capture, true); events.get(name)?.delete(callback);}};
  if (dom) document.querySelectorAll = selector => {
    assert.equal(selector, '[data-row-key][role="treeitem"]'); return rows;
  };
  const environment = {document, window:{getComputedStyle:node => ({overflowY:node.overflowY || 'visible'})},
    setTimeout(callback, delay) {const id = ++timerId; timers.set(id, {callback, due:now + delay}); return id;},
    clearTimeout:id => timers.delete(id)};
  if (observer) environment.MutationObserver = class {
    constructor(callback) {this.callback = callback; this.active = false; this.disconnects = 0; observers.push(this);}
    observe(node, options) {assert.equal(node, body); assert.equal(options.subtree, true); if (observerError) throw new Error('observer unavailable'); this.active = true;}
    disconnect() {this.active = false; this.disconnects++;}
  };
  const {revealProject} = vm.runInNewContext('(function(){' + helper + ';return {revealProject};})()', environment);
  const ctx = {sessions:{list:sessions}, workspaces:{list:workspaces}, layout:{panelInfo:panel}};
  function row(key, {expanded, top = 320, bottom = top + 24, visible = true, parent = sidebar, title = 'Same title', onClick} = {}) {
    const attrs = new Map([['data-row-key', key], ['title', title]]);
    if (expanded !== undefined) attrs.set('aria-expanded', String(expanded));
    const node = {parentElement:parent, attrs, textContent:title,
      getAttribute:name => attrs.get(name) ?? null,
      getClientRects:() => visible ? [{}] : [],
      getBoundingClientRect:() => ({top, bottom}),
      scrollIntoView() {assert.fail('must not scroll document or conversation with scrollIntoView');},
      click() {clicks.push(key); onClick?.(node);}};
    rows.push(node); return node;
  }
  function tick(milliseconds = 0) {
    const end = now + milliseconds;
    for (let count = 0; ; count++) {
      assert.ok(count < 100, 'bounded timer work');
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a,b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].due; next[1].callback();
    }
    now = end;
  }
  function mutate() {for (const item of observers) if (item.active) item.callback([]);}
  function event(name, isTrusted) {for (const callback of [...(events.get(name) || [])]) callback({isTrusted});}
  function select({id = 'blank', blank = true, retainedBy = {mainView:1}, extra = {}} = {}) {
    sessions.set({byId:{[id]:{id, blank, retainedBy}, ...extra}});
  }
  function begin(start = () => {}) {return revealProject(ctx, 'target', () => {starts++; start();});}
  function clean() {
    assert.equal(timers.size, 0, 'all timers cleared');
    assert.ok(observers.every(item => !item.active), 'observer disconnected');
    assert.ok([sessions,workspaces,panel].every(item => item.listeners.size === 0), 'store subscriptions removed');
    assert.ok([...events.values()].every(listeners => listeners.size === 0), 'input listeners removed');
  }
  return {ctx, target, sessions, workspaces, panel, rows, clicks, scrolls, sidebar, body, conversation,
    timers, events, observers, row, tick, mutate, event, select, begin, clean, starts:() => starts};
}

for (const [name, setup] of [
  ['old main-view session', h => {}],
  ['no main-view retain', h => h.select({retainedBy:{deepsearch:1}})],
  ['nonblank main-view session', h => h.select({blank:false})],
  ['blank flag omitted', h => h.sessions.set({byId:{blank:{id:'blank', retainedBy:{mainView:1}}}})],
  ['session outside target membership', h => h.select({id:'other'})],
  ['multiple main-view sessions', h => h.select({extra:{old:{id:'old', blank:true, retainedBy:{mainView:1}}}})],
  ['workspace list not ready', h => {h.select(); h.workspaces.set({phase:'loading', items:[h.target]});}],
  ['missing target workspace', h => {h.select(); h.workspaces.set({phase:'ready', items:[]});}],
  ['active panel not null', h => {h.select(); h.panel.set({activePanelId:'search'});}],
  ['panel readiness not explicit', h => {h.select(); h.panel.set({});}],
]) test('does not expand before successful native target selection: ' + name, () => {
  const h = harness();
  h.row('workspace:target', {expanded:false});
  // The initial snapshot is captured before native navigation changes stores.
  const stop = h.begin(() => setup(h)); h.tick();
  assert.equal(h.starts(), 1); assert.deepEqual(h.clicks, []); assert.deepEqual(h.scrolls, []);
  stop(); h.clean();
});

test('waits for successful blank selection, membership and panel dismissal before expansion', () => {
  const h = harness(); h.row('workspace:target', {expanded:false});
  const stop = h.begin(); h.tick(); assert.deepEqual(h.clicks, []);
  h.panel.set({activePanelId:'search'}); h.select(); h.tick(); assert.deepEqual(h.clicks, []);
  h.panel.set({activePanelId:null}); h.tick(); assert.deepEqual(h.clicks, ['workspace:target']);
  // A DOM click that has not committed expansion must not be toggled repeatedly.
  h.mutate(); h.tick(); assert.deepEqual(h.clicks, ['workspace:target']);
  stop(); stop(); h.clean();
});

test('delayed DOM render opens collapsed path ancestors in order, then exact target', () => {
  const h = harness();
  const root = {workspaceId:'root', path:'/projects', sessionIds:[]};
  const middle = {workspaceId:'middle', path:'/projects/nested', sessionIds:[]};
  h.target.path = '/projects/nested/target';
  h.workspaces.set({phase:'ready', items:[h.target,middle,root]});
  const stop = h.begin(() => h.select()); h.tick(); assert.deepEqual(h.clicks, []);
  h.row('workspace:root', {expanded:false, onClick(node) {
    node.attrs.set('aria-expanded','true');
    h.row('workspace:middle', {expanded:false, onClick(child) {
      child.attrs.set('aria-expanded','true');
      h.row('workspace:target', {expanded:false, onClick(target) {target.attrs.set('aria-expanded','true');}});
    }});
  }});
  h.mutate(); h.tick();
  assert.deepEqual(h.clicks, ['workspace:root','workspace:middle','workspace:target']);
  assert.deepEqual(h.scrolls, [], 'wait for the selected blank session DOM row');
  h.row('session:blank', {top:360}); h.mutate(); h.tick();
  assert.deepEqual(h.scrolls, [114]); h.clean(); stop(); h.clean();
});

test('uses exact IDs, not duplicate titles, prefixes, hidden rows or unrelated groups', () => {
  const h = harness();
  h.row('workspace:target-extra', {expanded:false});
  h.row('workspace:unrelated', {expanded:false});
  h.row('workspace:target', {expanded:false, visible:false});
  h.row('workspace:target', {expanded:true});
  h.row('session:blank-extra');
  h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.clicks, []); assert.deepEqual(h.scrolls, []);
  h.row('session:blank', {top:350}); h.mutate(); h.tick();
  assert.deepEqual(h.clicks, []); assert.deepEqual(h.scrolls, [104]); h.clean();
});

test('never collapses expanded ancestors or expands a path-prefix sibling', () => {
  const h = harness();
  h.target.path = 'C:\\projects\\target\\';
  h.workspaces.set({phase:'ready', items:[h.target,
    {workspaceId:'root',path:'C:\\projects\\',sessionIds:[]},
    {workspaceId:'sibling',path:'C:\\project',sessionIds:[]}]});
  h.row('workspace:root', {expanded:true}); h.row('workspace:sibling', {expanded:false});
  const stop = h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.clicks, []); assert.deepEqual(h.scrolls, []); stop(); h.clean();
});

for (const [name, geometry, expected] of [
  ['below viewport', {headerTop:320, sessionTop:350}, 104],
  ['above viewport', {headerTop:80, sessionTop:120}, 10],
  ['already visible', {headerTop:120, sessionTop:160}, null],
  ['group taller than viewport', {headerTop:320, sessionTop:700}, 74],
]) test('one-shot sidebar-only scroll: ' + name, () => {
  const h = harness(); h.row('workspace:target', {expanded:true, top:geometry.headerTop});
  h.row('session:blank', {top:geometry.sessionTop});
  h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.scrolls, expected === null ? [] : [expected]);
  assert.equal(h.body.scrollTop, 700); assert.equal(h.conversation.scrollTop, 900); h.clean();
  h.mutate(); h.select(); h.tick(9000);
  assert.deepEqual(h.scrolls, expected === null ? [] : [expected]); h.clean();
});

test('timeout stops delayed reveal and removes every resource', () => {
  const h = harness(); h.begin(); h.tick(7999);
  assert.equal(h.sessions.listeners.size, 1); h.tick(1); h.clean();
  h.row('workspace:target', {expanded:false}); h.select(); h.mutate(); h.tick();
  assert.deepEqual(h.clicks, []);
});

for (const name of ['wheel','touchstart','keydown','pointerdown']) {
  test('trusted ' + name + ' cancels while synthetic input does not', () => {
    const h = harness(); h.begin(); h.tick();
    h.event(name, false); assert.equal(h.sessions.listeners.size, 1);
    h.event(name, true); h.clean();
    h.row('workspace:target', {expanded:false}); h.select(); h.mutate(); h.tick();
    assert.deepEqual(h.clicks, []);
  });
}

test('trusted input synchronously during native start cannot leak a queued check', () => {
  const h = harness(); h.row('workspace:target', {expanded:false});
  h.begin(() => {h.select(); h.event('wheel', true);});
  h.clean(); h.tick(); assert.deepEqual(h.clicks, []);
});

test('another navigation before target selection supersedes reveal', () => {
  const h = harness(); h.begin(); h.tick(); h.select({id:'other'}); h.tick(); h.clean();
  h.row('workspace:target', {expanded:false}); h.select(); h.tick(); assert.deepEqual(h.clicks, []);
});

test('another navigation after target selection supersedes pending DOM reveal', () => {
  const h = harness(); h.begin(() => h.select()); h.tick();
  h.select({id:'other'}); h.tick(); h.clean();
  h.row('workspace:target', {expanded:false}); h.select(); h.tick(); assert.deepEqual(h.clicks, []);
});

test('missing DOM query support still calls native start exactly once', () => {
  const h = harness({dom:false}); const stop = h.begin();
  assert.equal(h.starts(), 1); assert.equal(typeof stop, 'function'); stop(); h.clean();
});

test('missing observable API falls back to native start without side effects', () => {
  const h = harness(); delete h.ctx.workspaces.list.subscribe;
  const stop = h.begin(); assert.equal(h.starts(), 1); stop(); h.clean();
});

test('missing MutationObserver can still reveal from store updates', () => {
  const h = harness({observer:false});
  h.row('workspace:target', {expanded:true}); h.row('session:blank', {top:350});
  h.begin(() => h.select()); h.tick(); assert.deepEqual(h.scrolls, [104]); h.clean();
});

test('missing sidebar scroller stops safely without document scrolling', () => {
  const h = harness(); h.row('workspace:target', {expanded:true, parent:h.body}); h.row('session:blank');
  h.begin(() => h.select()); h.tick(); assert.deepEqual(h.scrolls, []); assert.equal(h.body.scrollTop, 700); h.clean();
});

test('observer setup failure cleans up but never prevents native navigation', () => {
  const h = harness({observerError:true});
  assert.doesNotThrow(() => h.begin(() => h.select())); assert.equal(h.starts(), 1); h.clean();
});

test('nested sidebar list area and scrollport adjust inner-to-outer exactly once', () => {
  const h = harness(), outerScrolls = [];
  let outerTop = 10;
  const outer = {parentElement:h.body, overflowY:'auto', scrollHeight:2000, clientHeight:200,
    getAttribute:name => name === 'data-sidebar-scrollport' ? '' : null,
    hasAttribute:name => name === 'data-sidebar-scrollport',
    getBoundingClientRect:() => ({top:50,bottom:250})};
  Object.defineProperty(outer, 'scrollTop', {get:() => outerTop, set(value) {outerTop = value; outerScrolls.push(value);}});
  h.sidebar.parentElement = outer; h.sidebar.overflowY = 'hidden';
  h.sidebar.getAttribute = name => name === 'data-sidebar-list-area' ? '' : null;
  h.sidebar.hasAttribute = name => name === 'data-sidebar-list-area';
  const header = h.row('workspace:target', {expanded:true});
  const session = h.row('session:blank');
  header.getBoundingClientRect = () => ({top:320 - (h.sidebar.scrollTop - 30), bottom:344 - (h.sidebar.scrollTop - 30)});
  session.getBoundingClientRect = () => ({top:350 - (h.sidebar.scrollTop - 30), bottom:374 - (h.sidebar.scrollTop - 30)});
  h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.scrolls, [104], 'inner hidden-overflow sidebar list adjusted first');
  assert.deepEqual(outerScrolls, [60], 'outer scrollport uses geometry after inner adjustment');
  assert.equal(h.body.scrollTop, 700); assert.equal(h.conversation.scrollTop, 900); h.clean();
  h.mutate(); h.select(); h.tick(9000);
  assert.deepEqual(h.scrolls, [104]); assert.deepEqual(outerScrolls, [60]);
});

test('Windows ancestors normalize separators and all trailing slashes', () => {
  const h = harness();
  h.target.path = String.raw`C:\projects\nested\target\\`;
  h.workspaces.set({phase:'ready',items:[h.target,{workspaceId:'root',path:'C:/projects////',sessionIds:[]}]});
  h.row('workspace:root',{expanded:false});
  const stop = h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.clicks, ['workspace:root']); stop(); h.clean();
});

test('POSIX path backslashes remain literal, not Windows separators', () => {
  const h = harness(); h.target.path = String.raw`/projects/child\part/target`;
  h.workspaces.set({phase:'ready',items:[h.target,{workspaceId:'wrong',path:'/projects/child/part',sessionIds:[]}]});
  h.row('workspace:wrong',{expanded:false});
  const stop = h.begin(() => h.select()); h.tick();
  assert.deepEqual(h.clicks, []); stop(); h.clean();
});

test('synchronous start throw propagates the original error and cleans up', () => {
  const h = harness(); const error = new Error('native navigation failed');
  assert.throws(() => h.begin(() => {h.select(); throw error;}), value => value === error);
  assert.equal(h.starts(), 1); h.clean(); h.tick(); assert.deepEqual(h.clicks, []);
});
