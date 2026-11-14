import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('package.json',root)));
test('portable release exports manifest, locales, icon and backend without user paths',async()=>{
  assert.equal(manifest.exports['./package.json'],'./package.json');
  for(const language of ['en','zh-CN']) {
    const key='./locale/'+language+'.json';
    assert.ok(manifest.exports[key]);
    const locale=JSON.parse(readFileSync(new URL(manifest.exports[key],root)));
    assert.ok(locale.meta.title); assert.ok(locale.meta.description);
  }
  for(const file of [manifest.exports['.'],manifest.exports['./client'],manifest.icon]) assert.ok(existsSync(new URL(file,root)));
  const overlay=readFileSync(new URL('cordis.patch.yml',root),'utf8');
  assert.ok(overlay.includes("name: 'dsh-deepsearch'")); assert.ok(!overlay.includes('file:'));
  assert.equal((await import('dsh-deepsearch/package.json',{with:{type:'json'}})).default.name,manifest.name);
  const entry=await import('dsh-deepsearch'); assert.equal(typeof entry.apply,'function');
});
