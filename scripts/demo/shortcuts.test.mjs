import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockShortcuts} from './shortcuts.mjs';
import {startDemo} from './server.mjs';
import {readFile} from 'node:fs/promises';

test('shortcut mock only dispatches enabled command and restores defaults in memory',async()=>{
 const {service,edits,dispatches}=createMockShortcuts();let toggles=0;
 service.register({id:'deepsearch.toggle',resolve:()=>({run:()=>toggles++})});
 const event={code:'KeyK',metaKey:true,preventDefault(){}};
 assert.equal(service.dispatch(event),false);
 const edit=command=>service.edit(command,service.config.getSnapshot().revision);
 assert.equal((await service.edit({type:'set',id:'session.search',binding:null},0)).status,'stale');
 await edit({type:'set',id:'session.search',binding:null});
 await edit({type:'set',id:'deepsearch.toggle',binding:{code:'KeyK',modifiers:['meta']}});
 assert.equal(service.dispatch({...event,shiftKey:true}),false);
 assert.equal(service.dispatch(event),true);assert.equal(toggles,1);
 await edit({type:'reset',id:'deepsearch.toggle'});await edit({type:'reset',id:'session.search'});
 assert.deepEqual(service.config.getSnapshot().document.profiles['desktop:macos'],{});
 assert.equal(service.dispatch(event),false);assert.equal(edits.length,4);assert.deepEqual(dispatches,['deepsearch.toggle']);
});

test('loopback demo serves exact production client and only allowlisted fictional endpoints',async()=>{
 const demo=await startDemo({depsDir:'/unused-demo-test-deps'});
 try{
   const source=await fetch(demo.url+'/client.js').then(r=>r.text());
   assert.equal(source,await readFile(new URL('../../client.js',import.meta.url),'utf8'));
   const catalog=await fetch(demo.url+'/api/deepsearch/catalog?includeArchived=true').then(r=>r.json());
   assert.equal(catalog.sessions.length,5);assert.ok(catalog.sessions.every(row=>row.id.startsWith('demo-')));
   assert.equal((await fetch(demo.url+'/package.json')).status,404);
   assert.equal((await fetch(demo.url+'/api/sessions')).status,404);
   assert.equal((await fetch(demo.url+'/demo/shortcuts.mjs')).status,200);
 }finally{await demo.close();}
});
