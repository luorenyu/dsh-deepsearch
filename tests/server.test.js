import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, inject, readJson, MAX_BODY_BYTES} from '../host.js';

function host() {
  const routes = new Map(), cleanup = [], counts = {reads: 0};
  const ctx = {
    connection: {fetch: {register(route) {routes.set(route.path, route); return () => routes.delete(route.path);}}},
    effect(fn) {cleanup.push(fn());},
    sessionQuery: {async listSessions() {counts.reads++; return [];}, async readTitleSnapshots() {return [];}},
    sessionController: {async list() {return {items: []};}},
    workspaceController: {follow() {return {async next() {return {value: {type: 'baseline', value: {items: [], archivedSessionIds: []}}};}, async return() {return {done: true};}};}},
  };
  apply(ctx); return {routes, cleanup, counts, ctx};
}
const request = (body, headers = {}, extra = {}) => new Request('http://localhost/api/deepsearch/search', {
  method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body), ...extra,
});

test('injects public services and registers owner-gated fetch API, no raw listener', async () => {
  assert.deepEqual(inject, ['sessionQuery', 'sessionController', 'workspaceController', 'connection']);
  const {routes, cleanup} = host();
  // Missing requestBody falls into the host's streaming branch, invalid for GET.
  for (const route of routes.values()) assert.equal(route.requestBody, 'buffered', route.path);
  const search = routes.get('/api/deepsearch/search');
  assert.deepEqual(search.methods, ['POST']); assert.equal(search.requestBody, 'buffered');
  const response = await search.fetch(request({query: '中文'}));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), {items: [], cursor: null, scanned: 0, totalSessions: 0, warnings: [], workspaces: []});
  const catalog = routes.get('/api/deepsearch/catalog');
  assert.deepEqual(catalog.methods, ['GET']);
  assert.deepEqual(await (await catalog.fetch(new Request('http://localhost/api/deepsearch/catalog'))).json(), {workspaces: [], sessions: []});
  cleanup.forEach(fn => fn());
  assert.equal((await search.fetch(request({query: 'x'}))).status, 499);
});

test('catalog archive inclusion is opt-in and retains update timestamps', async () => {
  const {ctx,routes} = host();
  ctx.sessionQuery.listSessions = async () => [{header:{id:'arch',createdAt:10}}];
  ctx.sessionController.list = async () => ({items:[{sessionId:'arch',updatedAt:2000,projections:{values:{title:'Archived'}}}]});
  ctx.workspaceController.follow = () => ({async next() {return {value:{type:'baseline',value:{items:[],archivedSessionIds:['arch']}}};}, async return() {return {done:true};}});
  const route = routes.get('/api/deepsearch/catalog');
  for (const [query,expected] of [['',0],['?includeArchived=false',0],['?includeArchived=1',0],['?includeArchived=true',1]]) {
    const response = await route.fetch(new Request('http://localhost/api/deepsearch/catalog'+query));
    assert.equal(response.status,200);
    const body = await response.json(); assert.equal(body.sessions.length,expected);
    if (expected) assert.deepEqual(body.sessions[0],{id:'arch',title:'Archived',archived:true,updatedAt:2000});
  }
});

test('rejects unsupported methods, MIME, malformed JSON, unknown fields and invalid parameters', async () => {
  const {routes, counts} = host(); const fetch = routes.get('/api/deepsearch/search').fetch;
  const cases = [[new Request('http://localhost/api/deepsearch/search'), 405],
    [request('{}', {'content-type': 'text/plain'}), 415], [request('{'), 400],
    [request({query: ''}), 400], [request({query: 'x', includeArchived: 'false'}), 400], [request({query: 'x', injected: 1}), 400]];
  for (const [req, status] of cases) {
    const response = await fetch(req); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(counts.reads, 0);
});

test('JSON cap enforces declared and actual UTF-8 bytes before history reads', async () => {
  const {routes, counts} = host(); const fetch = routes.get('/api/deepsearch/search').fetch;
  for (const req of [request('{}', {'content-length': String(MAX_BODY_BYTES + 1)}), request('{}', {'content-length': '-1'}),
    request({query: '中'.repeat(6000)})]) assert.equal((await fetch(req)).status, 413);
  assert.equal(counts.reads, 0);
  await assert.rejects(readJson(new Request('http://localhost/api/deepsearch/search', {method: 'POST', headers: {'content-type': 'application/json'}, body: new Uint8Array([255])})), /Invalid JSON/);
});

test('request.signal cancellation is explicit and service failures do not leak private errors', async () => {
  const {routes, ctx} = host(); const fetch = routes.get('/api/deepsearch/search').fetch;
  const controller = new AbortController(); controller.abort();
  const cancelled = await fetch(request({query: 'x'}, {}, {signal: controller.signal})); assert.equal(cancelled.status, 499);
  assert.equal((await cancelled.json()).code, 'CANCELLED');
  ctx.sessionQuery.listSessions = async () => {throw new Error('/private/config credential');};
  const failed = await fetch(request({query: 'x'})); assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('/private'));
});
