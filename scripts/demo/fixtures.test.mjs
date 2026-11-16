import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,search} from './fixtures.mjs';
test('invented catalog and match ranges are internally consistent',()=>{
 assert.equal(catalog().workspaces.length,3);
 assert.equal(catalog().sessions.length,4);
 assert.equal(catalog({includeArchived:true}).sessions.length,5);
 assert.ok(catalog().sessions.every(row=>Number.isFinite(row.updatedAt)));
 const result=search({query:'验收记录'});
 assert.equal(result.items.length,4);
 for(const item of result.items)assert.equal(item.snippet.slice(...item.range),'验收记录');
});
test('workspace filter and archived flag change only fictional fixtures',()=>{
 assert.equal(search({query:'验收记录',workspaceId:'demo-orbit'}).items.length,2);
 const result=search({query:'验收记录',includeArchived:true});
 assert.equal(result.items.length,5);
 assert.ok(result.items.find(item=>item.title.includes('已归档') && item.archived===true));
 assert.equal(search({query:'不存在的词'}).items.length,0);
});
