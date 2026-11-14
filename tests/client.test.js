import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helperSource = source.slice(source.indexOf('    const MAX_RESULTS'), source.indexOf('    function Icon'));
const helpers = vm.runInNewContext('(function(){' + helperSource + ';return {selectedKeys,isShortcut,joinItems,loadExact,scanPages,searchStatus,currentSessionId,matchPreview,formatMessageTime,appearancePrefs,readAppearance,saveAppearance,appearanceStyle};})()', {setTimeout,clearTimeout});
test('match-first preview exposes Markdown link behind blank lines', () => {
  const keyword='验收记录与限制';
  const text='前面的说明。'.repeat(20)+'\n\n源码和说明已保存、提交 Git：\n\n- [使用说明](<DeepSearch/README.md>)\n- ['+keyword+'](<DeepSearch/docs/verification.md>)';
  const start=text.indexOf(keyword), preview=helpers.matchPreview(text,[start,start+keyword.length]);
  assert.equal(preview.text.slice(...preview.range),keyword);
  assert.ok(Array.from(preview.text.slice(0,preview.range[0])).length<=33);
  assert.doesNotMatch(preview.text,/\n| {2}/);
  assert.ok(preview.text.length<150);
});
test('match-first preview preserves Unicode, literal markup and long complete hits', () => {
  for(const hit of ['验收记录与限制','DeepSeek','<script>alert(1)</script>','中'.repeat(256),'a\nb']) {
    const text='😀'.repeat(80)+'é前文 '+hit+' 后文'.repeat(80),start=text.indexOf(hit);
    const p=helpers.matchPreview(text,[start,start+hit.length]);
    assert.equal(p.text.slice(...p.range),hit);
    assert.ok(p.text.length<=hit.length+32*2+64*2+2);
    assert.doesNotMatch(p.text,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  }
});
test('invalid preview ranges do not invent highlights and remain bounded', () => {
  for(const range of [null,[-1,2],[2,1],[0,2000],[0.5,2],[0,NaN]]) {
    const p=helpers.matchPreview('旧文\n'.repeat(400),range);
    assert.equal(p.range,null); assert.ok(p.text.length<=97);
  }
});
test('actual Mark renders literal keyword in mark after excerpt transformation', () => {
  const renderer=source.slice(source.indexOf('    function Mark('),source.indexOf('    const css'));
  const Mark=vm.runInNewContext('(function(){'+helperSource+renderer+';return Mark;})()', {setTimeout,clearTimeout,React:{Fragment:'fragment'},h:(tag,props,...children)=>({tag,children})});
  const text='前文\n\n'.repeat(20)+'[验收记录与限制](<DeepSearch/docs/verification.md>)';
  const start=text.indexOf('验收记录与限制');const tree=Mark({text,range:[start,start+7]});
  assert.equal(tree.children[1].tag,'mark'); assert.equal(tree.children[1].children[0],'验收记录与限制');
  assert.doesNotMatch(tree.children[0],/\n/);
});
test('preview has no line clamp to hide marked text', () => {
  assert.doesNotMatch(source,/-webkit-line-clamp/);
  assert.match(source,/matchPreview\(text, range\)/);
});
test('only dedicated shift shortcut activates; IME and repeats ignored', () => {
  const key = {key: 'k', metaKey: true, shiftKey: true};
  assert.equal(helpers.isShortcut(key), true);
  for (const override of [{shiftKey: false}, {altKey: true}, {isComposing: true}, {repeat: true}, {key: 'f'}]) assert.equal(helpers.isShortcut({...key,...override}), false);
});
test('exact seq adapter never selects nearest message', () => {
  const chat = {order: ['a','b','c'], nodes: new Map([['a',{anchorSeq: 2}],['b',{data:{finalNode:{seq:19}}}],['c',{data:{root:{seq:21}}}]])};
  assert.deepEqual(Array.from(helpers.selectedKeys(chat, 19)), ['b']);
  assert.deepEqual(Array.from(helpers.selectedKeys(chat, 18)), []);
});
test('result pages deduplicate and cap at 200', () => {
  assert.equal(helpers.joinItems([{id:1}], [{id:1},{id:2}]).length, 2);
  assert.equal(helpers.joinItems([], Array.from({length:250}, (_,id)=>({id}))).length, 200);
});
test('soft history load resolution is not navigation success', async () => {
  const session={getSnapshot:()=>({loadingOlder:false,hasMore:false}),subscribe:()=>()=>{},loadThrough:async()=>{}};
  const reference={ready:Promise.resolve(),binding:{session,eventSource:{getSnapshot:()=>({entries:[]})}}};
  await assert.rejects(helpers.loadExact(reference,5,()=>true), /历史中找不到/);
});
test('event coverage load preserves reference and accepts exact seq only', async () => {
  let entries=[];
  const session={getSnapshot:()=>({loadingOlder:false,hasMore:true}),subscribe:()=>()=>{},loadThrough:async()=>{entries=[{type:'event',event:{seq:5}}]}};
  const reference={ready:Promise.resolve(),binding:{session,eventSource:{getSnapshot:()=>({entries})}}};
  assert.equal(await helpers.loadExact(reference,5,()=>true),true);
});
test('cancelled history loads unsubscribe immediately including readiness waits', async () => {
  const pending = new Promise(()=>{}), before = new AbortController();
  const waiting = helpers.loadExact({ready:pending},5,()=>true,before.signal); before.abort();
  assert.equal(await waiting,false);
  let removed=0;
  const session={getSnapshot:()=>({loadingOlder:true,hasMore:true}),subscribe:()=>()=>{removed++},loadThrough:async()=>{}};
  const reference={ready:Promise.resolve(),binding:{session,eventSource:{getSnapshot:()=>({entries:[]})}}};
  const controller=new AbortController(), loading=helpers.loadExact(reference,5,()=>true,controller.signal);
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  assert.equal(await loading,false); assert.equal(removed,1);
});
test('floating UI has no backdrop, no raw HTML, same-origin requests', () => {
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.match(source,/backdrop-filter:var\(--ds-effective-filter/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /name: 'shell.overlay'/);
  assert.doesNotMatch(source, /inset:0/);
});
test('automatic scan traverses empty batches and continues after first hit', async () => {
  let calls=0; const updates=[];
  await helpers.scanPages({signal:new AbortController().signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=>{calls++;return {items:calls===5?[{id:'hit'}]:[],cursor:calls<8?'next':null,scanned:calls,totalSessions:8}},
    onPage:page=>updates.push(page)});
  assert.equal(calls,8); assert.equal(updates[4].items.length,1); assert.equal(updates.at(-1).cursor,null);
  assert.equal(updates.at(-1).items[0].id,'hit');
});
test('changed query discards late response and close cancels automatic continuation', async () => {
  let current=true, updates=0, calls=0; const controller=new AbortController();
  await helpers.scanPages({signal:controller.signal,isCurrent:()=>current,yieldPage:async()=>{},
    requestPage:async()=>{current=false;return {items:[{id:'stale'}],cursor:'next'}},onPage:()=>updates++});
  assert.equal(updates,0); current=true;
  await helpers.scanPages({signal:controller.signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=>{calls++;return {items:[],cursor:'next'}},onPage:()=>controller.abort()});
  assert.equal(calls,1);
});
test('automatic scan caps retained results and preserves partial cursor', async () => {
  let last, calls=0;
  await helpers.scanPages({signal:new AbortController().signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=>({items:Array.from({length:50},(_,i)=>({id:50*calls+i})),cursor:String(++calls)}),onPage:page=>{last=page}});
  assert.equal(calls,4); assert.equal(last.items.length,200); assert.ok(last.cursor);
});
test('search states never call incomplete or failed scans no matches', () => {
  const result={items:[],scanned:2,totalSessions:32,warnings:[],cursor:'next'};
  for(const override of [{busy:true},{error:'failed'},{},{result:{...result,cursor:null,warnings:['bad history']}}]) {
    const state=helpers.searchStatus({query:'使用说明',result,...override});
    assert.doesNotMatch(state.empty,/^没有找到匹配内容$/);
  }
  assert.equal(helpers.searchStatus({query:'使用说明',result:{...result,cursor:null,scanned:32}}).empty,'没有找到匹配内容');
});
test('preferred session uses main view retention, never an invented workspace field', () => {
  assert.equal(helpers.currentSessionId(undefined,{byId:{a:{id:'a',retainedBy:{tool:1}},b:{id:'b',retainedBy:{mainView:1}}}}),'b');
  assert.equal(helpers.currentSessionId(undefined,{byId:{}}),undefined);
  assert.equal(helpers.currentSessionId({key:'chosen'},{byId:{a:{id:'a',retainedBy:{mainView:1}}}}),'chosen');
});
test('warnings survive later clean pages and terminal overflow stays capped', async () => {
  let count=0,last;
  await helpers.scanPages({signal:new AbortController().signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=> ++count===1?{items:[],warnings:['read failed'],cursor:'next'}:{items:Array.from({length:201},(_,id)=>({id})),cursor:null},onPage:page=>{last=page}});
  assert.equal(last.warnings[0],'read failed'); assert.equal(last.capped,true);
  assert.match(helpers.searchStatus({query:'x',result:last}).footer,/上限/);
});
test('later failure leaves successful page and continuation available', async () => {
  let count=0,last;
  await assert.rejects(helpers.scanPages({signal:new AbortController().signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=>{if(++count===2)throw Error('read timeout');return {items:[{id:'kept'}],cursor:'retry'}},onPage:page=>{last=page}}),/read timeout/);
  assert.equal(last.items[0].id,'kept');assert.equal(last.cursor,'retry');
});
test('structured cumulative warnings are deduplicated across HTTP pages', async () => {
  let calls=0,last;
  await helpers.scanPages({signal:new AbortController().signal,isCurrent:()=>true,yieldPage:async()=>{},
    requestPage:async()=>({items:[],warnings:[{sessionId:'same',code:'read',message:'failed'}],cursor:++calls<8?'next':null}),onPage:page=>{last=page}});
  assert.equal(last.warnings.length,1);
});
test('retry handler resumes saved cursor instead of clearing successful hits', () => {
  const prefix='onClick: () => ', start=source.indexOf(prefix+'error && displayResult.cursor');
  assert.ok(start>=0);
  const body=source.slice(start+prefix.length,source.indexOf('},',start));
  const retry=vm.runInNewContext('(function(){return '+body+';})', {error:'timeout',displayResult:{cursor:'saved'},more:()=> 'resumed',setRetry:()=>{throw Error('restarted')}});
  assert.equal(retry(),'resumed');
});
test('package overlay and exports agree', () => {
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  const overlay=readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8');
  assert.equal(manifest.name,'@renyuluo/dsh-deepsearch');
  const entry = overlay.match(/name: '([^']+)'/)[1];
  assert.equal(entry, manifest.name); // Portable root package discovery, not a machine-specific file URL.
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.ok(!['file:', '/Users/'].some(part => overlay.includes(part)));
  assert.equal(manifest.exports['.'],'./runtime-'+manifest.version+'.js');
  assert.ok(source.includes("id: '@renyuluo/dsh-deepsearch'"));
});
