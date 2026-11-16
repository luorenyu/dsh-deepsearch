import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('    const HISTORY_KEY'), source.indexOf('    // Independent, local-only reminders'));
const key = 'dsh-deepsearch.search-history.v1';
function fixture(raw, now = 10000) {
  const data = new Map(raw === undefined ? [] : [[key, raw]]);
  const storage = {getItem: name => data.get(name) ?? null, setItem: (name,value) => data.set(name,value)};
  class Clock extends Date {static now() {return now++;}}
  const create = vm.runInNewContext('(function(){' + helper + ';return createSearchHistory;})()', {Date:Clock});
  return {data, storage, create, store:create(storage)};
}
const snapshot = store => JSON.parse(JSON.stringify(store.getSnapshot()));
test('history defaults empty and preference off; reads never write', () => {
  const {store,data} = fixture(); assert.deepEqual(snapshot(store), {defaultHistory:false,entries:[],error:''}); assert.equal(data.size,0);
  assert.equal(store.getSnapshot(),store.getSnapshot());
});
test('history trims, exact-deduplicates, orders newest and caps 30 without storing message payloads', () => {
  const {store,data} = fixture(); for(let i=0;i<35;i++) store.add('q'+i);
  assert.equal(store.getSnapshot().entries.length,30); assert.equal(store.getSnapshot().entries[0].query,'q34');
  store.add(' q12 '); assert.equal(store.getSnapshot().entries[0].query,'q12'); assert.equal(store.getSnapshot().entries.filter(x=>x.query==='q12').length,1);
  const saved=JSON.parse(data.get(key)); assert.deepEqual(Object.keys(saved).sort(),['defaultHistory','entries']); assert.deepEqual(Object.keys(saved.entries[0]).sort(),['query','time']);
  for(const invalid of ['', '  ', null, {}, 'x'.repeat(257)]) store.add(invalid);
  assert.equal(store.getSnapshot().entries.length,30); assert.equal(store.getSnapshot().entries[0].query,'q12');
});
test('preference, individual deletion and clear persist independently', () => {
  const {store,storage,create} = fixture(); store.add('one');store.add('two');store.setDefault(true);store.remove('one');
  const next=create(storage);assert.deepEqual(snapshot(next).entries.map(x=>x.query),['two']);assert.equal(next.getSnapshot().defaultHistory,true);
  next.clear();assert.equal(create(storage).getSnapshot().entries.length,0);assert.equal(create(storage).getSnapshot().defaultHistory,true);
  next.setDefault(false);assert.equal(create(storage).getSnapshot().defaultHistory,false);
});
test('malformed and oversized history is bounded and invalid entry data never renders', () => {
  for(const raw of ['{broken','x'.repeat(200001)]) {const {store}=fixture(raw);assert.equal(store.getSnapshot().entries.length,0);assert.match(store.getSnapshot().error,/无法读取/);}
  const {store}=fixture(JSON.stringify({defaultHistory:'true',entries:[{query:'good',time:5},{query:'',time:3},{query:'badtime',time:'5'},{query:'infinite-date',time:1e30},{query:'long'.repeat(100),time:8},null]}));
  assert.deepEqual(snapshot(store).entries,[{query:'good',time:5}]);assert.equal(store.getSnapshot().defaultHistory,false);
});
test('storage denial remains usable in memory with explicit warning', () => {
  const {create}=fixture();const store=create({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});
  store.add('secret keyword');assert.equal(store.getSnapshot().entries[0].query,'secret keyword');assert.match(store.getSnapshot().error,/无法保存/);
  store.clear();assert.equal(store.getSnapshot().entries.length,0);
  const unavailable=create();unavailable.add('offline');assert.match(unavailable.getSnapshot().error,/无法保存/);
});
test('reload accepts external clear/prefs and subscriptions clean up', () => {
  const {store,data}=fixture();let changes=0;const off=store.subscribe(()=>changes++);store.add('one');assert.equal(changes,1);
  data.set(key,JSON.stringify({defaultHistory:true,entries:[]}));store.reload();assert.equal(changes,2);assert.equal(store.getSnapshot().defaultHistory,true);assert.equal(store.getSnapshot().entries.length,0);
  off();store.add('two');assert.equal(changes,2);
});
