import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    const MAX_RESULTS'), source.indexOf('    function Icon'));
const locals = source.slice(source.indexOf('        let opened ='), source.indexOf('        async function api('));
const navigation = source.slice(source.indexOf('        function beginJump('), source.indexOf('        function Overlay()'));
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {getSnapshot: () => value, subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);},
    set(next) {value = next; for (const callback of [...listeners]) callback();}, listeners};
}
function harness({ready = Promise.resolve(), loadingOlder = false, entries = [{type:'event', event:{seq:7}}], highlight = true} = {}) {
  const timers = new Map(), calls = [], references = [], registrations = [], observers = [], domEvents = new Map(), highlights = new Map();
  let nextTimer = 0, slot, dirty = false, rendered, snapshots = [], cursor = 0, pending = [], mounted = false;
  const effects = [], stores = [], refs = [];
  const binding = observable({key:'old'}), panel = observable({activePanelId:null});
  const session = observable({loadingOlder, hasMore:true}); session.loadThrough = async () => {};
  const content = {dataset:{conversationSession:'target'}, rows:[], querySelectorAll:() => content.rows,
    addEventListener:(key, callback) => domEvents.set(key, callback), removeEventListener:key => domEvents.delete(key)};
  let contentAvailable = true;
  const nestedContent = {...content, closest:()=>({})};
  const frame = {addEventListener:content.addEventListener,removeEventListener:content.removeEventListener,querySelectorAll:selector => {assert.equal(selector, '[data-conversation-content][data-conversation-session]'); return contentAvailable ? [nestedContent,content] : [];}};
  content.closest=selector=>{assert.equal(selector,'[data-phase]');return frame;};
  const root = {closest:selector => {assert.equal(selector, 'header[data-window-drag]'); return {parentElement:{},closest:selector=>{assert.equal(selector,'[data-phase]');return frame;}};}};
  const ctx = {uiWorkspace:{openSession:id => {calls.push(['open',id]);}}, layout:{panelInfo:panel, selectPanel:id => {calls.push(['panel',id]); panel.set({activePanelId:id});}},
    uiSession:{adapter:{current:binding}}, sessions:{list:{getSnapshot:()=>({byId:{}})},retain(id, options) {
      calls.push(['retain',id,options.source]); const ref = {ready,binding:{session,eventSource:{getSnapshot:()=>({entries})}},releases:0,release(){this.releases++;}};
      references.push(ref); return ref;
    }}, slots:{inject(name, register) {calls.push(['inject',name]); register(); return () => {calls.push(['uninject',name]);};},
      register(options, component) {registrations.push(options); slot = component;}}};
  const React = {
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (!stores[index]) stores[index] = subscribe(() => {const next = getSnapshot(); if (!Object.is(next, snapshots[index])) dirty = true;});
      snapshots[index] = getSnapshot(); return snapshots[index];
    },
    useRef() {const index=cursor++; return refs[index] ||= {current:null};},
    useEffect(callback, deps) {const index = cursor++, old=effects[index]; if (!old || deps.some((value,i)=>!Object.is(value,old.deps[i]))) pending.push({index,callback,deps});},
  };
  const environment = {ctx, React, AbortController, NodeFilter:{SHOW_TEXT:4,FILTER_REJECT:2,FILTER_ACCEPT:1},
    h:(tag,props,...children)=>({tag,props:props||{},children}),
    window:{CSS:highlight?{highlights}:undefined, Highlight:highlight?class {constructor(range){this.range=range;}}:undefined},
    document:{activeElement:null, createTreeWalker(row, _, filter) {let i=0; const nodes=row.texts.filter(node=>filter.acceptNode(node)===1); return {nextNode:()=>nodes[i++]};},
      createRange(){return {setStart(node,index){this.start=[node,index];},setEnd(node,index){this.end=[node,index];},getClientRects:()=>[{}]};}},
    MutationObserver:class {constructor(callback){this.callback=callback;observers.push(this);} observe(){this.active=true;} disconnect(){this.active=false;}},
    setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id)};
  const code = '(function(){'+helpers+locals+navigation+';return {beginJump,clearIntent,getIntent:()=>intent,getOpened:()=>opened};})()';
  const api = vm.runInNewContext(code, environment);
  const chat = {order:['exact','near'],nodes:new Map([['exact',{anchorSeq:7}],['near',{anchorSeq:8}]])};
  function row(key, text, owner=content) {
    const attrs = new Map([['data-chat-node-key',key]]);
    return {attrs,texts:[{textContent:text,parentElement:{closest:()=>null}}],scrolls:0,
      getAttribute:name=>attrs.get(name),setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),
      closest:()=>owner,getClientRects:()=>[{}],scrollIntoView(){this.scrolls++;}};
  }
  function render(id='target') {
    cursor=0;pending=[];dirty=false;
    rendered = slot({sessionId:id,useChat:selector=>selector(chat),useSession:selector=>selector({openState:'open'})});
    if (rendered?.props.ref) rendered.props.ref.current=root;
    for (const {index,callback,deps} of pending) {effects[index]?.cleanup?.();effects[index]={deps,cleanup:callback()};}
    mounted=true; return rendered;
  }
  function unmount() {for (const effect of effects) effect?.cleanup?.();for(const unsubscribe of stores) unsubscribe?.();mounted=false;}
  function flush() {if(dirty && mounted) render();}
  const tick = async()=>{for(let i=0;i<8;i++)await Promise.resolve();flush();};
  return {...api,binding,panel,session,calls,references,registrations,observers,domEvents,highlights,timers,content,chat,row,render,unmount,flush,tick,
    setContentAvailable(value){contentAvailable=value;},get dirty(){return dirty;},get tree(){return rendered;},fireMutations(){for(const observer of observers)if(observer.active)observer.callback();},
    expire(delay){for(const [id,timer]of [...timers])if(timer.delay===delay){timers.delete(id);timer.callback();}flush();},
    start(){api.beginJump({sessionId:'target',seq:7},'Needle');binding.set({key:'target'});}};
}

test('native open order, additive slot, shared auxiliary reference; no replacement rendering', async () => {
  const h=harness();h.start();h.render();await h.tick();
  assert.deepEqual(h.calls.slice(0,2),[['open','target'],['panel',null]]);
  assert.deepEqual(h.registrations.map(registration=>registration.name),['conversation.session.header.utilities']);
  assert.deepEqual(h.calls.find(call=>call[0]==='retain'),['retain','target','gateway']);
  assert.equal(h.tree.tag,'div'); assert.equal(h.tree.children.some(child=>child?.tag==='SessionProvider'),false);
  h.clearIntent();assert.equal(h.references[0].releases,1);h.unmount();assert.equal(h.references[0].releases,1);
});

test('history completion changes a subscribed primitive snapshot and rerenders status', async () => {
  let resolve;const h=harness({ready:new Promise(done=>{resolve=done;})});h.start();h.render();
  assert.match(h.tree.children[1].children[0],/正在加载/);resolve();await h.tick();
  assert.equal(h.getIntent().loaded,true);assert.match(h.tree.children[1].children[0],/历史已加载/);
  h.unmount();assert.equal(h.getIntent(),null);
});

for(const cause of ['session switch','same-key binding replacement','panel switch','unmount','new jump','dispose']) {
  test(cause+' immediately cancels actual loading subscriptions and releases reference once',async()=>{
    const h=harness({entries:[],loadingOlder:true});h.start();h.render();await h.tick();
    assert.equal(h.session.listeners.size,1);
    if(cause==='session switch')h.binding.set({key:'other'});
    else if(cause==='same-key binding replacement')h.binding.set({key:'target'});
    else if(cause==='panel switch')h.panel.set({activePanelId:'settings'});
    else if(cause==='unmount')h.unmount();
    else if(cause==='new jump')h.beginJump({sessionId:'next',seq:8},'next');
    else h.clearIntent();
    assert.equal(h.session.listeners.size,0);assert.equal(h.references[0].releases,1);
    h.clearIntent();h.unmount();assert.equal(h.references[0].releases,1);
    assert.equal(h.binding.listeners.size,0);assert.equal(h.panel.listeners.size,0);assert.equal(h.timers.size,0);
  });
}

test('native exact row only, literal escaped iu text across nodes, scoped CSS Highlight and synchronous DOM cleanup',async()=>{
  const h=harness();h.beginJump({sessionId:'target',seq:7},'[K].');h.binding.set({key:'target'});
  const nearby=h.row('near','[K].'),nested=h.row('exact','[K].',{}),exact=h.row('exact','[k].');
  exact.texts=[{textContent:'prefix [',parentElement:{closest:()=>null}},{textContent:'k]. suffix',parentElement:{closest:()=>null}}];
  h.content.rows=[nearby,nested,exact];h.render();await h.tick();h.flush();
  assert.equal(nearby.scrolls,0);assert.equal(nested.scrolls,0);assert.equal(exact.scrolls,1);
  assert.equal(h.highlights.size,1);assert.ok(exact.attrs.has('data-deepsearch-hit'));
  const range=h.highlights.get('deepsearch-hit').range;
  assert.equal(range.start[1],7);assert.equal(range.end[1],3);
  assert.match(h.getIntent().status,/已定位并高亮/);
  h.panel.set({activePanelId:'files'});
  assert.equal(h.highlights.size,0);assert.equal(exact.attrs.has('data-deepsearch-hit'),false);
  assert.ok(h.observers.every(observer=>!observer.active));assert.equal(h.domEvents.size,0);assert.equal(h.timers.size,0);
  h.unmount();
});

test('loaded without exact native row never selects nearest or claims located',async()=>{
  const h=harness();h.content.rows=[h.row('near','Needle')];h.start();h.render();await h.tick();h.expire(8000);
  assert.match(h.getIntent().status,/历史已加载，但宿主未呈现对应消息/);assert.equal(h.highlights.size,0);assert.equal(h.content.rows[0].scrolls,0);h.unmount();
});

test('located but unavailable CSS highlight reports not-marked honestly',async()=>{
  const h=harness({highlight:false});h.content.rows=[h.row('exact','Needle')];h.start();h.render();await h.tick();h.expire(8000);
  assert.match(h.getIntent().status,/已定位对应消息/);assert.doesNotMatch(h.getIntent().status,/并高亮/);assert.equal(h.highlights.size,0);h.unmount();
});

test('wrong session content is never searched; return-search clears auxiliary state without native close',async()=>{
  const h=harness();h.content.dataset.conversationSession='embedded';h.content.rows=[h.row('exact','Needle')];h.start();h.render();await h.tick();
  assert.equal(h.content.rows[0].scrolls,0);h.expire(8000);assert.match(h.getIntent().status,/当前原生会话区域不可用/);h.tree.children[2].props.onClick();
  assert.equal(h.getOpened(),true);assert.equal(h.getIntent(),null);assert.equal(h.references[0].releases,1);
  assert.equal(h.calls.filter(call=>call[0]==='open').length,1);h.unmount();
});

test('wrapped native content is retried within bounded observation and nested phase roots are excluded',async()=>{
  const h=harness();h.setContentAvailable(false);h.content.rows=[h.row('exact','Needle')];h.start();h.render();await h.tick();
  assert.equal(h.content.rows[0].scrolls,0);assert.ok(h.observers.some(observer=>observer.active));
  h.setContentAvailable(true);h.fireMutations();h.flush();
  assert.equal(h.content.rows[0].scrolls,1);assert.match(h.getIntent().status,/已定位并高亮/);assert.equal(h.timers.size,0);h.unmount();
});

test('missing sibling observation expires and navigation cancels pending retry immediately',async()=>{
  for(const cancel of [false,true]) {
    const h=harness();h.setContentAvailable(false);h.start();h.render();await h.tick();
    if(cancel)h.panel.set({activePanelId:'files'});else h.expire(8000);
    if(!cancel)assert.match(h.getIntent().status,/当前原生会话区域不可用/);
    assert.ok(h.observers.every(observer=>!observer.active));assert.equal(h.timers.size,0);
    h.setContentAvailable(true);h.fireMutations();assert.equal(h.highlights.size,0);h.unmount();
  }
});

test('late readiness after navigation cannot mark or resurrect cancelled native locator',async()=>{
  let resolve;const h=harness({ready:new Promise(done=>{resolve=done;})});h.start();h.render();
  h.panel.set({activePanelId:'search'});resolve();await h.tick();
  assert.equal(h.getIntent(),null);assert.equal(h.references[0].releases,1);assert.equal(h.highlights.size,0);assert.equal(h.timers.size,0);h.unmount();
});
