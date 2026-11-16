#!/usr/bin/env node
// Reproducible README screenshots: actual client.js, invented API/context only.
// Requires Node >=22, npm and agent-browser (with Chromium installed).
// Installs pinned React exclusively in a fresh OS temporary directory.
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {startDemo} from './demo/server.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'docs/images');
const temporary=await mkdtemp(path.join(tmpdir(),'deepsearch-readme-'));
const session='deepsearch-readme-'+process.pid;
let demo,browserStarted=false;
const records=[];
const approved08=await readFile(path.join(output,'08-unread-menu.png'));
const approved08Sha256=createHash('sha256').update(approved08).digest('hex');
// Never inherit a user's browser profile, remote CDP or saved authentication state.
const env={...process.env,TZ:'Asia/Shanghai'};
for(const key of Object.keys(env))if(key.startsWith('AGENT_BROWSER_'))delete env[key];
async function browser(...args) {
 const result=await exec('agent-browser',['--session',session,...args],{env,maxBuffer:4*1024*1024,timeout:45000});
 if(result.stderr.trim())process.stderr.write(result.stderr);
 return result.stdout.trim();
}
async function evaluate(js){return browser('eval',js);}
async function caption(text){await evaluate('document.getElementById("demo-caption").textContent='+JSON.stringify(text));}
async function settle(count){
 await browser('wait','--fn','document.querySelectorAll(".deepsearch-result").length==='+count+' && document.querySelector(".deepsearch-results").getAttribute("aria-busy")==="false"');
 await browser('wait','--fn','document.querySelector(".deepsearch-footer").textContent.includes("搜索完成")');
}
async function shot(file,title){
 await caption(title);
 await browser('screenshot',path.join(output,file));
 let state=JSON.parse(await evaluate('JSON.stringify({appearance:document.querySelector(".deepsearch-panel")?.dataset.appearance ?? null,savedAppearance:JSON.parse(localStorage.getItem("dsh-deepsearch.appearance.v1")),workspace:document.querySelector("[aria-label=工作区范围]")?.value ?? null,archived:[...document.querySelectorAll("label")].find(n=>n.textContent.trim()==="含归档")?.querySelector("input")?.checked ?? null,defaultHistory:[...document.querySelectorAll("label")].find(n=>n.textContent.trim()==="默认历史")?.querySelector("input")?.checked ?? null,historyTabs:[...document.querySelectorAll("[aria-label=起始列表] [role=tab]")].map(n=>({label:n.textContent,selected:n.getAttribute("aria-selected")})),history:JSON.parse(localStorage.getItem("dsh-deepsearch.search-history.v1")),shortcutSwitch:document.querySelector("[aria-labelledby=deepsearch-shortcut-label]")?.getAttribute("aria-checked") ?? null,shortcutEdits:window.__DEEPSEARCH_DEMO__.shortcutEdits,mockProjectStarts:window.__DEEPSEARCH_DEMO__.mockProjectStarts,resultCount:document.querySelectorAll(".deepsearch-result").length,marks:[...document.querySelectorAll("mark")].map(n=>n.textContent),footer:document.querySelector(".deepsearch-footer")?.textContent ?? null,nativeNavigationAttempted:window.__DEEPSEARCH_DEMO__.nativeNavigationAttempted,unread:JSON.parse(localStorage.getItem("dsh-deepsearch.manual-unread.v1")),unreadSwitch:document.querySelector("[aria-labelledby=deepsearch-unread-label]")?.getAttribute("aria-checked") ?? null,leadingDots:[...document.querySelectorAll(".demo-session-row [aria-label=手动未读]")].map(n=>({sessionId:n.closest(".demo-session-row").dataset.sessionId,primitive:n.querySelector("[data-mock-primitive]")?.dataset.mockPrimitive,state:n.querySelector("[data-state]")?.dataset.state})),menuItems:[...document.querySelectorAll("[role=menuitem]")].map(n=>n.textContent),registeredSlots:window.__DEEPSEARCH_DEMO__.registeredSlots,registeredMenus:window.__DEEPSEARCH_DEMO__.registeredMenus})'));
 if(typeof state==='string')state=JSON.parse(state);
 if(state.nativeNavigationAttempted)throw new Error('Native navigation unexpectedly attempted');
 if(state.marks.some(mark=>mark!=='验收记录'))throw new Error('Unexpected highlight text');
 if(file==='07-unread-settings.png' && (state.unreadSwitch!=='true'||!state.unread?.enabled))throw new Error('Unread settings not enabled');
 if(file==='component-unread-evidence.png' && (state.leadingDots.length!==1||state.leadingDots[0].sessionId!=='demo-s1'||state.leadingDots[0].primitive!=='StateDot'||state.leadingDots[0].state!=='done'||state.menuItems[0]!=='标记为未读'))throw new Error('Unread menu/leading-slot evidence mismatch');
 if(state.footer && !state.footer.includes(' 0.1.17 /'))throw new Error('Expected current 0.1.17 component footer');
 if(file==='09-history.png' && (!state.defaultHistory || state.historyTabs[0]?.label!=='搜索历史' || state.historyTabs[0]?.selected!=='true' || !state.history?.entries.some(entry=>entry.query==='验收记录')))throw new Error('History evidence mismatch');
 if(file==='10-settings.png' && state.shortcutSwitch!=='true')throw new Error('Mock CmdK takeover evidence mismatch');
 const bytes=await readFile(path.join(output,file));
 records.push({file,title,sha256:createHash('sha256').update(bytes).digest('hex'),...state});console.log('Captured '+file);
}
try {
 await mkdir(output,{recursive:true});
 await exec('npm',['install','--prefix',temporary,'--no-save','--package-lock=false','react@18.3.1','react-dom@18.3.1'],{env,maxBuffer:4*1024*1024,timeout:120000});
 demo=await startDemo({depsDir:temporary});
 browserStarted=true;
 await browser('set','viewport','1180','960');
 await browser('open',demo.url);
 await browser('wait','--fn','window.__DEEPSEARCH_DEMO__?.loaded');
 await browser('press','Control+Shift+k');
 // Current component includes archived sessions by default; choose the baseline explicitly.
 await browser('uncheck','label:has-text("含归档") input');
 await browser('find','label','搜索会话正文','fill','验收记录');
 await settle(4);
 await shot('01-search.png','中文片段搜索 · 命中摘要高亮 · 消息时间');
 // Project results now invoke host New Session, not workspace scoping.
 // Capture the actual action hint, then verify only our in-memory host callback.
 await browser('find','role','tab','click','--name','项目','--exact');
 await browser('find','label','搜索会话正文','fill','星河');
 await browser('wait','--fn','document.querySelectorAll(".deepsearch-result").length===1');
 await shot('02-projects.png','项目入口 · 点击或回车新建会话（宿主调用仅为 mock）');
 await browser('find','role','option','click','--name','星河 · 客户端体验 工作区 · 点击或回车新建会话');
 await browser('wait','--fn','!document.querySelector(".deepsearch-panel") && window.__DEEPSEARCH_DEMO__.mockProjectStarts[0]==="demo-orbit"');
 await browser('press','Control+Shift+k');
 // Current component includes archived sessions by default; choose the baseline explicitly.
 await browser('uncheck','label:has-text("含归档") input');
 await browser('find','label','搜索会话正文','fill','验收记录');
 await settle(4);
 await browser('select','[aria-label="工作区范围"]','demo-orbit');
 await settle(2);
 await browser('select','[aria-label="工作区范围"]','');
 await settle(4);
 await browser('find','label','含归档','check');
 await settle(5);
 await shot('03-archived.png','勾选「含归档」· 找回旧方案的历史记录');
 await browser('uncheck','label:has-text("含归档") input');
 await settle(4);
 await browser('find','role','button','click','--name','设置','--exact');
 await browser('select','.deepsearch-appearance select','glass');
 await shot('04-glass.png','外观 · 毛玻璃面板（背景与主题令牌由 mock 提供）');
 await browser('select','.deepsearch-appearance select','theme');
 await evaluate('document.body.dataset.theme="dark"');
 await shot('05-theme.png','外观 · 跟随 DSH（深色主题令牌由 mock 提供）');
 await browser('select','.deepsearch-appearance select','custom');
 // Native color input uses the component onChange; no DOM screenshot replacement.
 await evaluate('(()=>{const n=document.querySelector("input[type=color]");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(n,"#203b48");n.dispatchEvent(new Event("input",{bubbles:true}));n.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await browser('focus','input[type=range][min="55"]');
 await browser('press','ArrowLeft');await browser('press','ArrowLeft');await browser('press','ArrowLeft');
 await shot('06-custom.png','外观 · 自定义底色、不透明度与模糊');
 // Exercise the real switch and plugin context-menu/leading-slot components.
 if(records.find(record=>record.file==='04-glass.png').unreadSwitch!=='false')throw new Error('Unread must default to disabled');
 await evaluate('document.body.dataset.theme="light"');
 await browser('find','role','button','click','--name','恢复默认','--exact');
 await browser('find','role','switch','click','--name','会话未读标记','--exact');
 await browser('wait','--fn','document.querySelector("[aria-labelledby=deepsearch-unread-label]").getAttribute("aria-checked")==="true"');
 await shot('07-unread-settings.png','设置 · 会话未读标记（默认关闭，可按需开启）');
 await browser('find','role','button','click','--name','关闭 DeepSearch','--exact');
 await evaluate('document.body.dataset.scene="unread"');
 const contextMenu=id=>evaluate('document.querySelector('+JSON.stringify('[data-session-id="'+id+'"]')+').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
 await contextMenu('demo-s1');
 await browser('find','role','menuitem','click','--name','标记为未读','--exact');
 await browser('wait','--fn','document.querySelectorAll(".demo-session-row [aria-label=手动未读]").length===1');
 await contextMenu('demo-s2');
 await shot('component-unread-evidence.png','右键标记未读 · 左侧 StateDot 原生样式示意（模拟宿主，非宿主截图）');
 // Clear via the plugin's reverse action, then verify mainView re-entry auto-read.
 await evaluate('window.__DEEPSEARCH_DEMO__.closeMenu()');
 await contextMenu('demo-s1');
 await browser('find','role','menuitem','click','--name','标记为已读','--exact');
 await browser('wait','--fn','document.querySelectorAll(".demo-session-row [aria-label=手动未读]").length===0');
 await contextMenu('demo-s1');
 await browser('find','role','menuitem','click','--name','标记为未读','--exact');
 await browser('find','role','button','click','--name','搜索面板：中文检索体验','--exact');
 await browser('wait','--fn','JSON.parse(localStorage.getItem("dsh-deepsearch.manual-unread.v1")).ids.length===0 && document.querySelectorAll(".demo-session-row [aria-label=手动未读]").length===0');
 const unreadChecks={defaultDisabled:true,markUnread:true,markRead:true,autoReadOnMockMainViewReentry:true};
 // The approved illustration is immutable and deliberately separate from runtime evidence.
 if(createHash('sha256').update(await readFile(path.join(output,'08-unread-menu.png'))).digest('hex')!==approved08Sha256)throw new Error('Approved 08 illustration changed');
 records.push({file:'08-unread-menu.png',title:'Approved unread illustration',presentation:'Approved fictional sidebar illustration; framing and content unchanged; not runtime evidence',sha256:approved08Sha256,behavioralEvidenceImage:'component-unread-evidence.png'});
 await evaluate('document.body.dataset.scene="search"');
 await browser('press','Control+Shift+k');
 await browser('find','role','button','click','--name','设置','--exact');
 // Clear earlier interaction history through real controls, then record a stable fixture.
 await browser('find','label','搜索会话正文','fill','');
 await browser('find','role','tab','click','--name','搜索历史','--exact');
 await browser('find','role','button','click','--name','清空搜索历史','--exact');
 // Collect history through the real 1-second debounce rather than injecting history rows.
 for(const query of ['中文检索','工作区筛选','验收记录']){
   await browser('find','label','搜索会话正文','fill',query);
   await browser('wait','--fn','JSON.parse(localStorage.getItem("dsh-deepsearch.search-history.v1"))?.entries[0]?.query==='+JSON.stringify(query));
 }
 await browser('find','label','搜索会话正文','fill','');
 await browser('find','label','默认历史','check');
 await browser('find','role','tab','click','--name','搜索历史','--exact');
 await browser('find','role','button','click','--name','关闭 DeepSearch','--exact');
 await browser('press','Control+Shift+k');
 await browser('wait','--fn','document.querySelector(".deepsearch-history-row") && document.querySelector("[aria-label=起始列表] [role=tab]").textContent==="搜索历史"');
 await shot('09-history.png','搜索历史 / 最近对话 · 默认历史（真实插件、本机虚构记录）');
 await browser('find','role','button','click','--name','重新搜索：验收记录','--exact');
 await settle(4);
 await browser('find','role','button','click','--name','设置','--exact');
 await browser('find','role','switch','click','--name','使用 ⌘K 打开 DeepSearch','--exact');
 await browser('wait','--fn','document.querySelector("[aria-labelledby=deepsearch-shortcut-label]").getAttribute("aria-checked")==="true"');
 await shot('10-settings.png','紧凑设置 · ⌘K 接管已开启（仅内存 mock 快捷键服务）');
 await browser('find','role','button','click','--name','关闭 DeepSearch','--exact');
 await browser('press','Meta+k');
 await browser('wait','--fn','document.querySelector(".deepsearch-panel") && window.__DEEPSEARCH_DEMO__.shortcutDispatches.length===1');
 await browser('find','role','switch','click','--name','使用 ⌘K 打开 DeepSearch','--exact');
 await browser('wait','--fn','document.querySelector("[aria-labelledby=deepsearch-shortcut-label]").getAttribute("aria-checked")==="false" && localStorage.getItem("dsh-deepsearch.shortcut-takeover.v1")===null');
 let shortcutChecks=JSON.parse(await evaluate('JSON.stringify({mockOnly:true,enabledAndRestored:true,edits:window.__DEEPSEARCH_DEMO__.shortcutEdits,dispatches:window.__DEEPSEARCH_DEMO__.shortcutDispatches})'));
 if(typeof shortcutChecks==='string')shortcutChecks=JSON.parse(shortcutChecks);
 const historyChecks={realDebouncedRecording:true,defaultPersistsAcrossReopen:true,replay:true};
 await writeFile(path.join(output,'screenshots.json'),JSON.stringify(records.map(record=>'docs/images/'+record.file),null,2)+'\n');
 const errors=await browser('errors');
 if(errors && !errors.includes('No errors'))throw new Error('Browser errors: '+errors);
 const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 const source=await readFile(path.join(root,'client.js'));
 await writeFile(path.join(output,'demo-evidence.json'),JSON.stringify({
  source:'client.js (served byte-for-byte, never rewritten)',sourceSha256:createHash('sha256').update(source).digest('hex'),version:manifest.version,
  renderer:'React 18.3.1 / ReactDOM 18.3.1',browser:'agent-browser isolated fresh session',viewport:{width:1180,height:960},
  privacy:'No real host, accounts, private sessions, CDP, user browser profile, or user data directories accessed. Native navigation blocked.',
  real:['Overlay React component','Mark excerpt highlighting','keyboard shortcut','project New Session action (mock callback only)','history tabs, debounce and replay','shortcut takeover controller (mock service only)','workspace filter','archive checkbox','appearance controls','unread settings switch','unread store','context-menu resolver and actions','ManualUnreadDot leading-slot component','client CSS'],
  mocked:['module loader and injected host context','catalog/search API responses','invented Chinese content and timestamps; deterministic local-history Date.now clock (real debounce timers)','background and host theme CSS tokens','sidebar rows and context-menu frame','StateDot primitive visual (not the native host implementation)','mainView retention transitions for fictional sessions','in-memory macOS desktop shortcut config/catalog/edit/dispatch; no actual host shortcut configuration','project New Session callback; no actual session creation'],
  unreadChecks,historyChecks,shortcutChecks,approved08Sha256,
  screenshots:records,requests:demo.requests,
 },null,2)+'\n');
} finally {
 if(browserStarted){try{await browser('close');}catch(error){console.error('Browser cleanup failed:',error.message);process.exitCode=1;}}
 if(demo)await demo.close();
 await rm(temporary,{recursive:true,force:true});
}
