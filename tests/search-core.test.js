import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchService, literalSnippet, validateInput, LIMITS} from '../search-core.js';

const user = (text, seq = 1, source = 'user') => ({type: 'user/message', seq, time: 100 + seq,
  data: {source: source ? {kind: source} : undefined, content: [{type: 'text', text}]}});
const event = (type, data, seq) => ({type, data, seq, time: 100 + seq});
const assistant = (text, seq, turn = 't', extra = {}) => event('assistant/message',
  {turn, message: {content: [{type: 'text', text}]}, ...extra}, seq);

function fixture(rows = [{id: 's', title: '普通标题', events: []}], workspace = {}) {
  const counts = {disposed: 0, observed: [], followersClosed: 0};
  const ctx = {
    sessionQuery: {
      async listSessions(signal) {signal?.throwIfAborted(); return rows.map(row => ({header: {id: row.id, cwd: row.cwd, origin: row.origin, createdAt: row.time ?? 1}}));},
      async readTitleSnapshots(ids) {return ids.map(id => ({sessionId: id, status: 'fulfilled', value: {title: {title: rows.find(row => row.id === id).title ?? ''}}}));},
      async observeSession(id, {signal, projectionMode}) {
        assert.equal(projectionMode, 'none'); signal.throwIfAborted(); counts.observed.push(id);
        const row = rows.find(row => row.id === id);
        if (row.error) throw new Error('private path /secret/session');
        if (row.onObserve) row.onObserve(signal);
        return {source: row.source, events: row.events, cursor: row.events.at(-1)?.seq ?? -1, revision: row.revision,
          [Symbol.dispose]() {counts.disposed++;}};
      },
    },
    sessionController: {async list() {return {items: rows.filter(row => !row.cold).map(row => ({sessionId: row.id, blank: row.blank,
      origin: row.origin, cwd: row.cwd, updatedAt: row.time ?? 1, projections: {values: {title: row.title}}}))};}},
    workspaceController: {follow() {return {async next() {return {done: false, value: {type: 'baseline', value: {
      items: workspace.items ?? [], archivedSessionIds: workspace.archived ?? [],
    }}};}, async return() {counts.followersClosed++; return {done: true};}};}},
  };
  return {ctx, counts, service: createSearchService(ctx)};
}

async function allPages(service, input) {
  const items = []; let cursor; let pages = 0, result;
  do {result = await service.search({...input, ...(cursor ? {cursor} : {})}); items.push(...result.items); cursor = result.cursor; assert.ok(++pages < 100);}
  while (cursor);
  return {items, result, pages};
}

test('Chinese arbitrary substring, English case, regex metacharacters and original UTF-16 ranges', async () => {
  for (const [text, query, expected] of [['任意连续中文片段', '续中', '续中'], ['DeepSeek', 'deepseek', 'DeepSeek'],
    ['İ 😀 DeepSeek', 'deepseek', 'DeepSeek'], ['a.*[b](c){d}\\e^$+?|', '.*[b](c){d}\\e^$+?|', '.*[b](c){d}\\e^$+?|']]) {
    const match = await literalSnippet(text, query);
    assert.ok(match); assert.equal(match.snippet.slice(...match.range), expected);
  }
  assert.equal(await literalSnippet('anything', '.*'), null);
  assert.equal(await literalSnippet('a  b', 'a b'), null);
});

test('long text and chunk-boundary matches stay bounded and preserve emoji', async () => {
  const text = 'x'.repeat(65535) + '😀中文needle' + 'y'.repeat(100000);
  for (const query of ['😀中文', 'needle', 'x'.repeat(1024)]) {
    const match = await literalSnippet(text, query);
    assert.ok(match.snippet.length <= LIMITS.snippetLength + 2);
    assert.equal(match.snippet.slice(...match.range), query);
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(match.snippet));
  }
});

test('search includes titles, human user input and only completed final assistant text', async () => {
  const events = [user('needle input', 1), user('needle automated', 2, 'tool'), user('needle unknown', 3, ''),
    event('turn/start', {turn: 't'}, 4), assistant('needle commentary', 5),
    event('tool/result', {message: {content: [{type: 'text', text: 'needle tool'}]}}, 6),
    assistant('needle final', 7, 't', {message: {content: [{type: 'reasoning', text: 'secret reasoning'}, {type: 'text', text: 'needle final'}]}}),
    event('turn/end', {turn: 't', reason: {kind: 'completed'}}, 8),
    event('turn/start', {turn: 'bad'}, 9), assistant('needle interrupted', 10, 'bad', {interrupted: true}),
    event('turn/end', {turn: 'bad', reason: {kind: 'completed'}}, 11),
    event('turn/start', {turn: 'tool'}, 12), assistant('needle toolcall', 13, 'tool', {message: {content: [{type: 'text', text: 'needle'}, {type: 'tool-call'}]}}),
    event('turn/end', {turn: 'tool', reason: {kind: 'completed'}}, 14),
    event('turn/start', {turn: 'failed'}, 15), assistant('needle failed', 16, 'failed'),
    event('turn/end', {turn: 'failed', reason: {kind: 'failed'}}, 17),
    event('assistant/attempt', {stream: [{type: 'reasoning-chunks', texts: ['needle']} ]}, 18)];
  const {service, counts} = fixture([{id: 's', title: 'needle title', events}]);
  const {items} = await service.search({query: 'needle'});
  assert.deepEqual(items.map(item => [item.kind, item.seq]), [['title', undefined], ['message', 7], ['message', 1]]);
  assert.equal(counts.disposed, 1); assert.equal(counts.followersClosed, 1);
  assert.deepEqual((await service.search({query: 'secret reasoning'})).items, []);
});

test('same-session pagination returns all 137 messages without duplicates or loss', async () => {
  const {service, counts} = fixture([{id: 's', title: 'needle title', events: Array.from({length: 137}, (_, i) => user('needle ' + i, i + 1))}]);
  const {items, result, pages} = await allPages(service, {query: 'needle'});
  assert.equal(items.length, 138); assert.equal(new Set(items.map(item => item.id)).size, 138);
  assert.deepEqual(items.filter(item => item.kind === 'message').map(item => item.seq), Array.from({length: 137}, (_, i) => 137 - i));
  assert.equal(pages, 4); assert.equal(result.scanned, 1); assert.equal(result.totalSessions, 1);
  assert.equal(counts.disposed, 4);
});

test('event-budget cursor preserves completed turn eligibility across page boundary', async () => {
  const {ctx} = fixture([{id: 's', title: '', events: [event('turn/start', {turn: 't'}, 1), assistant('needle', 2), event('turn/end', {turn: 't', reason: {kind: 'completed'}}, 3)]}]);
  const service = createSearchService(ctx, {eventsPerPage: 1});
  const first = await service.search({query: 'needle'});
  assert.equal(first.items.length, 0); assert.ok(first.cursor); assert.equal(first.scanned, 0);
  const next = await service.search({query: 'needle', cursor: first.cursor});
  assert.equal(next.items[0].seq, 2); assert.ok(next.cursor); assert.equal(next.scanned, 0);
  const last = await service.search({query: 'needle', cursor: next.cursor});
  assert.deepEqual(last.items, []); assert.equal(last.cursor, null); assert.equal(last.scanned, 1);
});

test('session batching reports cumulative scanned and returns continuation on empty page', async () => {
  const {service} = fixture(Array.from({length: 10}, (_, i) => ({id: 's' + i, title: '', events: i === 9 ? [user('needle')] : []})));
  const first = await service.search({query: 'needle'});
  assert.equal(first.scanned, 8); assert.ok(first.cursor); assert.equal(first.items.length, 0);
  const next = await service.search({query: 'needle', cursor: first.cursor});
  assert.equal(next.scanned, 10); assert.equal(next.items.length, 1); assert.equal(next.cursor, null);
});

test('catalog includes cold normal history, excludes subagents blank archived, maps only exact workspaces', async () => {
  const rows = [{id: 'a', title: 'A', cwd: '/project', events: []}, {id: 'b', title: 'B', cwd: '/project/sub', events: [], cold: true},
    {id: 'archived', title: 'arch', events: []}, {id: 'agent', origin: 'subagent', events: []}, {id: 'blank', blank: true, events: []}];
  const {service, counts} = fixture(rows, {items: [{workspaceId: 'w', title: 'Project', path: '/project', sessionIds: []}], archived: ['archived']});
  assert.deepEqual(await service.catalog(), {workspaces: [{id: 'w', title: 'Project'}], sessions: [{id: 'a', title: 'A', archived: false, workspaceId: 'w'}, {id: 'b', title: 'B', archived: false}]});
  assert.equal(counts.observed.length, 0);
  assert.equal((await service.search({query: 'arch', includeArchived: true})).items.length, 1);
  await assert.rejects(service.search({query: 'x', sessionId: 'agent'}), /excluded/);
  await assert.rejects(service.search({query: 'x', sessionId: 'b', workspaceId: 'w'}), /belong/);
});

test('title and message results explicitly report archived status with filters and scopes', async () => {
  for (const archivedCold of [false, true]) {
    const messages = [user('needle input'), event('turn/start', {turn: 't'}, 2), assistant('needle final', 3),
      event('turn/end', {turn: 't', reason: {kind: 'completed'}}, 4)];
    const {service} = fixture([
      {id: 'active', title: 'needle active', events: messages, cold: !archivedCold},
      {id: 'archived', title: 'needle archived', events: messages, cold: archivedCold},
      {id: 'outside', title: 'needle outside', events: messages},
    ], {items: [{workspaceId: 'w', title: 'Project', sessionIds: ['active', 'archived']}], archived: ['archived']});
    const cases = [
      [{}, ['active', 'outside']],
      [{includeArchived: false}, ['active', 'outside']],
      [{includeArchived: true}, ['active', 'archived', 'outside']],
      [{workspaceId: 'w'}, ['active']],
      [{workspaceId: 'w', includeArchived: false}, ['active']],
      [{workspaceId: 'w', includeArchived: true}, ['active', 'archived']],
      [{sessionId: 'active', workspaceId: 'w', includeArchived: true}, ['active']],
      [{sessionId: 'archived', workspaceId: 'w', includeArchived: true}, ['archived']],
    ];
    for (const [scope, ids] of cases) {
      const result = await service.search({query: 'needle', ...scope});
      assert.equal(result.totalSessions, ids.length);
      assert.deepEqual(result.items.map(item => [item.sessionId, item.kind, item.role, item.archived]),
        ids.flatMap(id => [['title', undefined], ['message', 'assistant'], ['message', 'user']]
          .map(([kind, role]) => [id, kind, role, id === 'archived'])));
    }
    for (const includeArchived of [undefined, false]) {
      await assert.rejects(service.search({query: 'needle', sessionId: 'archived', includeArchived}), /excluded/);
    }
    await assert.rejects(service.search({query: 'needle', sessionId: 'outside', workspaceId: 'w', includeArchived: true}), /belong/);
    service.dispose();
  }
});

test('cursor pages retain archived metadata and filtering from the initial catalog snapshot', async () => {
  for (const includeArchived of [false, true]) {
    const workspace = {items: [{workspaceId: 'w', title: 'Project', sessionIds: ['active', 'archived']}], archived: ['archived']};
    const {ctx} = fixture([
      {id: 'active', title: 'needle active', events: [user('needle active body')]},
      {id: 'archived', title: 'needle archived', events: [user('needle archived body')]},
    ], workspace);
    const service = createSearchService(ctx, {pageSize: 1});
    const input = {query: 'needle', workspaceId: 'w', includeArchived};
    const first = await service.search(input);
    assert.ok(first.cursor);
    assert.deepEqual(first.items.map(item => [item.sessionId, item.kind, item.archived]), [['active', 'title', false]]);
    workspace.archived = ['active'];
    await assert.rejects(service.search({...input, includeArchived: !includeArchived, cursor: first.cursor}),
      error => error.code === 'CURSOR_MISMATCH');
    const remaining = await allPages(service, {...input, cursor: first.cursor});
    const originalIds = includeArchived ? ['active', 'archived'] : ['active'];
    assert.deepEqual([...first.items, ...remaining.items].map(item => [item.sessionId, item.kind, item.archived]),
      originalIds.flatMap(id => ['title', 'message'].map(kind => [id, kind, id === 'archived'])));
    const refreshed = await allPages(service, input);
    const refreshedIds = includeArchived ? ['active', 'archived'] : ['archived'];
    assert.deepEqual(refreshed.items.map(item => [item.sessionId, item.kind, item.archived]),
      refreshedIds.flatMap(id => ['title', 'message'].map(kind => [id, kind, id === 'active'])));
    service.dispose();
  }
});

test('cursor is scope-bound, single-use, expires or evicts within bounded cache', async () => {
  const {ctx} = fixture([{id: 's', title: '', events: [user('a', 1), user('a', 2)]}]);
  const service = createSearchService(ctx, {pageSize: 1, maxCursors: 1});
  const first = await service.search({query: 'a'});
  await assert.rejects(service.search({query: 'b', cursor: first.cursor}), error => error.code === 'CURSOR_MISMATCH');
  const second = await service.search({query: 'a'});
  await assert.rejects(service.search({query: 'a', cursor: first.cursor}), error => error.code === 'CURSOR_EXPIRED');
  await service.search({query: 'a', cursor: second.cursor});
  await assert.rejects(service.search({query: 'a', cursor: second.cursor}), error => error.code === 'CURSOR_EXPIRED');
  const expiring = createSearchService(ctx, {pageSize: 1, cursorTtlMs: -1});
  const expired = await expiring.search({query: 'a'});
  await assert.rejects(expiring.search({query: 'a', cursor: expired.cursor}), error => error.code === 'CURSOR_EXPIRED');
});

test('history revision change invalidates rather than silently skipping shifted events', async () => {
  const row = {id: 's', title: '', events: [user('x', 1), user('x', 2)]};
  const {ctx, counts} = fixture([row]); const service = createSearchService(ctx, {pageSize: 1});
  const first = await service.search({query: 'x'}); row.events.push(user('x', 3));
  await assert.rejects(service.search({query: 'x', cursor: first.cursor}), error => error.code === 'HISTORY_CHANGED');
  assert.equal(counts.disposed, 2);
});

test('live append-only pages finish the original cut without missing or duplicate documents', async () => {
  for (const eventsPerPage of [1, 3, 100]) {
    const row = {id: 's', title: '', source: 'live', events: [user('needle old', 2),
      event('turn/start', {turn: 'done'}, 10), assistant('needle commentary', 20, 'done'),
      assistant('needle final', 50, 'done'), event('turn/end', {turn: 'done', reason: {kind: 'completed'}}, 90),
      user('needle recent', 100), event('turn/start', {turn: 'running'}, 200), assistant('needle unfinished', 300, 'running')]};
    const {ctx, counts} = fixture([row]); const service = createSearchService(ctx, {pageSize: 1, eventsPerPage});
    const items = []; let page = await service.search({query: 'needle'}), pages = 0;
    for (;;) {
      items.push(...page.items); assert.ok(++pages < 20);
      if (!page.cursor) break;
      const seq = row.events.at(-1).seq;
      row.events = [...row.events, event('tool/result', {text: 'needle tool'}, seq + 10), user('needle appended', seq + 20)];
      if (pages === 1) row.events.push(event('turn/end', {turn: 'running', reason: {kind: 'completed'}}, seq + 30));
      page = await service.search({query: 'needle', cursor: page.cursor});
    }
    assert.deepEqual(items.map(item => item.seq), [100, 50, 2]);
    assert.equal(new Set(items.map(item => item.id)).size, 3);
    assert.equal(page.scanned, 1); assert.equal(counts.disposed, pages);
    const refreshed = await allPages(service, {query: 'needle'});
    assert.ok(refreshed.items.some(item => item.seq === 300), 'new search sees newly completed turn');
    assert.ok(refreshed.items.some(item => item.snippet === 'needle appended'));
  }
});

test('live continuation rejects truncation, shifted anchors, source and revision changes', async () => {
  const changes = [
    row => {row.events = row.events.slice(0, 2);},
    row => {row.events = [user('x shifted', 0), ...row.events];},
    row => {row.events = [user('x changed unread', 1), ...row.events.slice(1)];},
    row => {row.source = 'prepared';},
    row => {row.revision = {generation: 2}; row.events.push(user('x', 400));},
    row => {row.events.push(user('x', 99));},
  ];
  for (const change of changes) {
    const row = {id: 's', title: '', source: 'live', events: [user('x', 2), user('x', 100), user('x', 300)]};
    const {ctx, counts} = fixture([row]); const service = createSearchService(ctx, {pageSize: 2});
    const first = await service.search({query: 'x'}); assert.ok(first.cursor); change(row);
    await assert.rejects(service.search({query: 'x', cursor: first.cursor}), error => error.code === 'HISTORY_CHANGED');
    assert.equal(counts.disposed, 2);
  }
  for (const source of ['prepared', undefined]) {
    const row = {id: 's', title: '', source, events: [user('x', 2), user('x', 100)]};
    const {ctx} = fixture([row]); const service = createSearchService(ctx, {pageSize: 1});
    const first = await service.search({query: 'x'}); row.source = 'live'; row.events.push(user('x', 300));
    await assert.rejects(service.search({query: 'x', cursor: first.cursor}), error => error.code === 'HISTORY_CHANGED');
  }
});

test('read failure warns safely, continues, and warning list is capped', async () => {
  const {ctx} = fixture(Array.from({length: 6}, (_, i) => ({id: 's' + i, title: '', events: [], error: true})));
  const service = createSearchService(ctx, {maxWarnings: 2});
  const result = await service.search({query: 'x'});
  assert.equal(result.scanned, 6); assert.equal(result.warnings.length, 2);
  assert.ok(!JSON.stringify(result).includes('/secret'));
});

test('already aborted, in-flight and CPU text scans stop and dispose their leases', async () => {
  const before = new AbortController(); before.abort();
  const {service} = fixture(); await assert.rejects(service.search({query: 'x'}, before.signal), {name: 'AbortError'});
  const controller = new AbortController();
  const {service: running, counts} = fixture([{id: 's', title: '', events: [user('x'.repeat(3000000))], onObserve() {setImmediate(() => controller.abort());}}]);
  await assert.rejects(running.search({query: 'missing'}, controller.signal), {name: 'AbortError'});
  assert.equal(counts.disposed, 1);
  const disposed = fixture(); disposed.service.dispose();
  await assert.rejects(disposed.service.search({query: 'x'}), {name: 'AbortError'});
});



test('concurrent searches are bounded and cursor cancellation is retryable', async () => {
  const {ctx} = fixture([{id: 's', title: '', events: [user('x', 1), user('x', 2), user('x', 3)]}]);
  const service = createSearchService(ctx, {maxConcurrent: 1, pageSize: 1});
  const first = await service.search({query: 'x'});
  const original = ctx.sessionQuery.observeSession;
  let release, entered;
  const started = new Promise(resolve => {entered = resolve;});
  ctx.sessionQuery.observeSession = async (...args) => {
    entered(); await new Promise(resolve => {release = resolve;}); return original(...args);
  };
  const controller = new AbortController();
  const pending = service.search({query: 'x', cursor: first.cursor}, controller.signal);
  await started;
  await assert.rejects(service.search({query: 'x'}), error => error.code === 'SEARCH_BUSY');
  controller.abort(); release();
  await assert.rejects(pending, {name: 'AbortError'});
  ctx.sessionQuery.observeSession = original;
  const retried = await service.search({query: 'x', cursor: first.cursor});
  assert.equal(retried.items[0].seq, 2);
});

test('cache byte ceiling fails explicitly instead of retaining unbounded snapshot', async () => {
  const {ctx} = fixture([{id: 's', title: 'x'.repeat(500), events: [user('x', 1), user('x', 2)]}]);
  const service = createSearchService(ctx, {pageSize: 1, cacheBytes: 32});
  await assert.rejects(service.search({query: 'x'}), error => error.code === 'CACHE_LIMIT');
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const nextTask = () => new Promise(resolve => setImmediate(resolve));

test('four cancelled nonsettling observations release every concurrency slot', {timeout: 1000}, async () => {
  const {ctx} = fixture([{id: 's', title: '', events: [user('x')]}]);
  const original = ctx.sessionQuery.observeSession;
  const service = createSearchService(ctx);
  for (let attempt = 0; attempt < 4; attempt++) {
    const entered = deferred(), never = deferred();
    ctx.sessionQuery.observeSession = () => {entered.resolve(); return never.promise;};
    const controller = new AbortController();
    const search = service.search({query: 'x'}, controller.signal);
    await entered.promise; controller.abort();
    await assert.rejects(search, {name: 'AbortError'});
  }
  ctx.sessionQuery.observeSession = original;
  assert.equal((await service.search({query: 'x'})).items[0].seq, 1);
});

test('late observation leases are disposed once and late rejections are consumed', {timeout: 1000}, async () => {
  const {ctx} = fixture();
  const service = createSearchService(ctx);
  let disposed = 0;
  for (const completion of ['resolve', 'reject']) {
    const entered = deferred(), pending = deferred();
    ctx.sessionQuery.observeSession = () => {entered.resolve(); return pending.promise;};
    const controller = new AbortController();
    const search = service.search({query: 'x'}, controller.signal);
    await entered.promise; controller.abort();
    await assert.rejects(search, {name: 'AbortError'});
    if (completion === 'resolve') pending.resolve({[Symbol.dispose]() {disposed++;}});
    else pending.reject(new Error('late provider failure'));
    await nextTask();
  }
  assert.equal(disposed, 1);
});

test('server deadline bounds nonsettling observations and preserves a timed-out cursor for retry', {timeout: 1000}, async () => {
  assert.equal(LIMITS.operationTimeoutMs, 15000);
  const {ctx} = fixture([{id: 's', title: '', events: [user('x', 1), user('x', 2)]}]);
  const service = createSearchService(ctx, {pageSize: 1, maxConcurrent: 1, operationTimeoutMs: 15});
  const first = await service.search({query: 'x'});
  const original = ctx.sessionQuery.observeSession, pending = deferred();
  ctx.sessionQuery.observeSession = () => pending.promise;
  await assert.rejects(service.search({query: 'x', cursor: first.cursor}), error => error.code === 'SEARCH_TIMEOUT' && error.status === 504);
  let disposed = 0;
  pending.resolve({[Symbol.dispose]() {disposed++;}});
  await nextTask(); assert.equal(disposed, 1);
  ctx.sessionQuery.observeSession = original;
  assert.equal((await service.search({query: 'x', cursor: first.cursor})).items[0].seq, 1);
});

test('search and catalog deadlines bound every metadata provider including iterator cleanup', {timeout: 2000}, async () => {
  for (const operation of ['search', 'catalog']) {
    for (const provider of ['sessions', 'metadata', 'titles', 'next', 'return']) {
      const {ctx} = fixture([{id: 's', title: '', cold: true, events: []}]);
      const pending = deferred();
      if (provider === 'sessions') ctx.sessionQuery.listSessions = () => pending.promise;
      if (provider === 'metadata') ctx.sessionController.list = () => pending.promise;
      if (provider === 'titles') ctx.sessionQuery.readTitleSnapshots = () => pending.promise;
      if (provider === 'next' || provider === 'return') {
        const follow = ctx.workspaceController.follow;
        ctx.workspaceController.follow = (...args) => ({...follow(...args), [provider]: () => pending.promise});
      }
      const service = createSearchService(ctx, {operationTimeoutMs: 15});
      const result = operation === 'search' ? service.search({query: 'x'}) : service.catalog();
      await assert.rejects(result, error => error.code === 'SEARCH_TIMEOUT', operation + '/' + provider);
      pending.reject(new Error('late metadata failure'));
      await nextTask(); service.dispose();
    }
  }
});

test('service disposal interrupts a nonsettling observation without waiting for its provider', {timeout: 1000}, async () => {
  const {ctx} = fixture(); const entered = deferred();
  ctx.sessionQuery.observeSession = () => {entered.resolve(); return new Promise(() => {});};
  const service = createSearchService(ctx), search = service.search({query: 'x'});
  await entered.promise; service.dispose();
  await assert.rejects(search, {name: 'AbortError'});
});

test('huge preferred current session finds its newest completed 使用说明 in the first bounded page', async () => {
  const oldEvents = Array.from({length: 4096}, (_, i) => user('ancient history', 10 + i * 3));
  // The completed turn can itself span thousands of events: no forward walk to
  // its start is required to find the final answer immediately at the tail.
  const events = [event('turn/start', {turn: 'large'}, 1), ...oldEvents,
    assistant('😀 最新使用说明', 20000, 'large'),
    event('turn/end', {turn: 'large', reason: {kind: 'completed'}}, 20001),
    event('turn/start', {turn: 'running'}, 20002), assistant('使用说明 unfinished', 20003, 'running')];
  const reads = [];
  const observed = new Proxy(events, {get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key));
    return Reflect.get(target, key, receiver);
  }});
  const rows = Array.from({length: 12}, (_, i) => ({id: 'other-' + i, time: 100 + i, title: '', events: []}));
  rows.push({id: 'current', time: 1, title: '', events: observed});
  const {service, counts} = fixture(rows);
  const first = await service.search({query: '使用说明', preferredSessionId: 'current'});
  assert.deepEqual(first.items.map(item => [item.sessionId, item.seq]), [['current', 20000]]);
  assert.equal(first.items[0].snippet.slice(...first.items[0].range), '使用说明');
  assert.ok(first.cursor); assert.equal(first.scanned, 0); assert.equal(first.totalSessions, 13);
  assert.deepEqual(counts.observed, ['current']); assert.equal(counts.disposed, 1);
  // Provider cursor, frozen cutoff and next-unread seq are three O(1) anchor reads.
  assert.ok(reads.length <= LIMITS.eventsPerPage + 3);
  assert.ok(Math.min(...reads) >= events.length - LIMITS.eventsPerPage - 1);
});

test('reverse pagination preserves final-only and human-only documents across event and result boundaries with seq gaps', async () => {
  const events = [], expected = []; let seq = 7;
  const add = item => {events.push({...item, seq, time: 100 + seq}); seq += 11; return events.at(-1).seq;};
  for (const kind of ['completed', 'tool', 'interrupted', 'failed', 'empty']) {
    expected.push(add(user('needle human ' + kind)));
    add(user('needle automation', 1, 'tool')); add(user('needle missing source', 1, ''));
    add(event('turn/start', {turn: 'reused'}, 1));
    add(assistant('needle commentary', 1, 'reused'));
    add(event('tool/result', {text: 'needle tool result'}, 1));
    const last = add(assistant(kind === 'empty' ? '' : 'needle last ' + kind, 1, 'reused', {
      ...(kind === 'interrupted' ? {interrupted: true} : {}),
      ...(kind === 'tool' ? {message: {content: [{type: 'text', text: 'needle tool call'}, {type: 'tool-call'}]}} : {}),
    }));
    add(event('turn/end', {turn: 'reused', reason: {kind: kind === 'failed' ? 'failed' : 'completed'}}, 1));
    if (kind === 'completed') expected.push(last);
  }
  expected.push(add(user('needle newest human')));
  add(event('turn/start', {turn: 'running'}, 1)); add(assistant('needle running', 1, 'running'));
  for (const eventsPerPage of [1, 2, 5, 17]) for (const pageSize of [1, 3]) {
    const {ctx, counts} = fixture([{id: 's', title: 'needle title', events}]);
    const service = createSearchService(ctx, {eventsPerPage, pageSize});
    const {items, result, pages} = await allPages(service, {query: 'needle'});
    assert.equal(items[0].kind, 'title');
    assert.deepEqual(items.slice(1).map(item => item.seq), [...expected].reverse(), eventsPerPage + '/' + pageSize);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    assert.equal(result.scanned, 1); assert.equal(result.cursor, null);
    assert.equal(counts.disposed, counts.observed.length); assert.ok(counts.disposed <= pages);
    service.dispose();
  }
});

test('preference promotes one permitted session without filtering or reordering the others', async () => {
  const rows = [{id: 'old', time: 1}, {id: 'new', time: 3}, {id: 'middle', time: 2}]
    .map(row => ({...row, title: '', events: [user('needle', 9)]}));
  const {ctx} = fixture(rows);
  const service = createSearchService(ctx, {pageSize: 1});
  const {items, result} = await allPages(service, {query: 'needle', preferredSessionId: 'old'});
  assert.deepEqual(items.map(item => item.sessionId), ['old', 'new', 'middle']);
  assert.equal(result.totalSessions, 3);
  assert.deepEqual((await allPages(service, {query: 'needle'})).items.map(item => item.sessionId), ['new', 'middle', 'old']);
});

test('out-of-scope missing archived blank and subagent preferences are ignored, never admitted or rejected', async () => {
  const rows = [{id: 'a', time: 2}, {id: 'b', time: 1}, {id: 'outside', time: 3},
    {id: 'archive', time: 4}, {id: 'agent', origin: 'subagent', time: 5}, {id: 'blank', blank: true, time: 6}]
    .map(row => ({...row, title: '', events: [user('needle')]}));
  const {service} = fixture(rows, {archived: ['archive'], items: [
    {workspaceId: 'w', title: 'Workspace', sessionIds: ['a', 'b', 'archive', 'agent', 'blank']},
    {workspaceId: 'other', title: 'Other', sessionIds: ['outside']},
  ]});
  for (const preferredSessionId of ['missing', 'outside', 'archive', 'agent', 'blank']) {
    const scoped = await service.search({query: 'needle', workspaceId: 'w', preferredSessionId});
    assert.deepEqual(scoped.items.map(item => item.sessionId), ['a', 'b']); assert.equal(scoped.totalSessions, 2);
    const single = await service.search({query: 'needle', sessionId: 'a', preferredSessionId});
    assert.deepEqual(single.items.map(item => item.sessionId), ['a']);
  }
  const archived = await service.search({query: 'needle', preferredSessionId: 'archive', includeArchived: true});
  assert.deepEqual(archived.items.map(item => item.sessionId), ['archive', 'outside', 'a', 'b']);
  const subagent = await service.search({query: 'needle', preferredSessionId: 'agent', includeArchived: true});
  assert.deepEqual(subagent.items.map(item => item.sessionId), ['archive', 'outside', 'a', 'b']);
});

test('cursor binds preference as well as query and filters, even when preference is outside scope', async () => {
  const {ctx} = fixture([{id: 's', title: '', events: [user('needle', 1), user('needle', 10)]}]);
  const service = createSearchService(ctx, {pageSize: 1});
  const first = await service.search({query: 'needle', preferredSessionId: 'outside'});
  assert.equal(first.items[0].seq, 10);
  for (const scope of [{}, {preferredSessionId: 's'}, {preferredSessionId: 'outside', sessionId: 's'},
    {preferredSessionId: 'outside', includeArchived: true}])
    await assert.rejects(service.search({query: 'needle', cursor: first.cursor, ...scope}), error => error.code === 'CURSOR_MISMATCH');
  assert.equal((await service.search({query: 'needle', preferredSessionId: 'outside', cursor: first.cursor})).items[0].seq, 1);
  assert.equal(validateInput({query: 'x', preferredSessionId: 'x'.repeat(512)}).preferredSessionId.length, 512);
});

test('validation rejects malformed scope and unsupported options before service reads', () => {
  for (const input of [null, [], {}, {query: ''}, {query: ' '}, {query: 'x'.repeat(1025)}, {query: 'x', sessionId: ''},
    {query: 'x', preferredSessionId: ''}, {query: 'x', preferredSessionId: ' '}, {query: 'x', preferredSessionId: 1},
    {query: 'x', preferredSessionId: null}, {query: 'x', preferredSessionId: 'x'.repeat(513)}, {query: 'x', includeArchived: 'true'}, {query: 'x', includeArchived: null}, {query: 'x', regex: true}])
    assert.throws(() => validateInput(input));
});
