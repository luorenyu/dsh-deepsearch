import {randomUUID} from 'node:crypto';

export const LIMITS = Object.freeze({pageSize: 40, sessionsPerPage: 8, eventsPerPage: 2048,
  maxSessions: 10000, maxWorkspaces: 2000, maxConcurrent: 4, maxWarnings: 32, maxCursors: 16, cacheBytes: 8 * 1024 * 1024,
  cursorTtlMs: 120000, operationTimeoutMs: 15000, queryLength: 1024, snippetLength: 1280});

export class SearchError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') {
    super(message); this.name = 'SearchError'; this.status = status; this.code = code;
  }
}

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchError('Expected a JSON object');
  const allowed = new Set(['query', 'cursor', 'sessionId', 'preferredSessionId', 'workspaceId', 'includeArchived']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new SearchError('Unknown search parameter');
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > LIMITS.queryLength)
    throw new SearchError('query must contain 1–1024 characters');
  const result = {query: input.query, includeArchived: input.includeArchived === undefined ? false : input.includeArchived};
  if (typeof result.includeArchived !== 'boolean') throw new SearchError('includeArchived must be boolean');
  for (const key of ['cursor', 'sessionId', 'preferredSessionId', 'workspaceId']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 512)
      throw new SearchError(key + ' must be nonempty text of at most 512 characters');
    result[key] = input[key];
  }
  return result;
}

const yieldTask = () => new Promise(resolve => setImmediate(resolve));
const check = signal => signal?.throwIfAborted();
const keyOf = input => JSON.stringify([input.query, input.sessionId ?? null, input.workspaceId ?? null, input.includeArchived, input.preferredSessionId ?? null]);
const textOf = content => (Array.isArray(content) ? content : []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
const pathKey = value => {
  if (typeof value !== 'string' || !value) return '';
  const path = value.replace(/\\/g, '/').replace(/\/+$/u, '') || '/';
  return /^[a-z]:(?:\/|$)/iu.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
};

// Escaped literal only. Original UTF-16 match indices survive Unicode casing.
export async function literalSnippet(text, query, signal) {
  const escaped = query.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'iu');
  const chunkSize = 65536;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    check(signal);
    const start = offset > 0 && /[\uDC00-\uDFFF]/u.test(text[offset]) ? offset - 1 : offset;
    const match = pattern.exec(text.slice(start, offset + chunkSize + query.length + 2));
    if (match) {
      const index = start + match.index;
      let left = Math.max(0, index - 90);
      let right = Math.min(text.length, Math.max(left + 320, index + match[0].length + 90));
      right = Math.min(right, left + LIMITS.snippetLength - 2);
      if (left && /[\uDC00-\uDFFF]/u.test(text[left])) left--;
      if (right < text.length && /[\uDC00-\uDFFF]/u.test(text[right])) right++;
      const prefix = left ? '…' : '';
      return {snippet: prefix + text.slice(left, right) + (right < text.length ? '…' : ''),
        range: [prefix.length + index - left, prefix.length + index - left + match[0].length]};
    }
    await yieldTask();
  }
  return null;
}

// Provider cancellation is cooperative; stop waiting even if a provider ignores it.
// Keep both settlement handlers attached so late rejections are always consumed.
function awaitProvider(signal, operation, discard) {
  check(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); reject(signal.reason);
    };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => {check(signal); return operation();}).then(value => {
      if (settled) {
        try {discard?.(value);} catch { /* Late cleanup cannot change the completed request. */ }
        return;
      }
      settled = true; signal.removeEventListener('abort', abort); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); reject(error);
    });
    if (signal.aborted) abort();
  });
}

async function workspaceSnapshot(controller, signal) {
  const stream = controller.follow(signal);
  try {
    const frame = await awaitProvider(signal, () => stream.next()); check(signal);
    if (frame.done || frame.value.type !== 'baseline') throw new SearchError('Workspace catalog unavailable', 503, 'CATALOG_UNAVAILABLE');
    return frame.value.value;
  } finally {
    // Iterator return may queue behind a pending next(); never let cleanup block cancellation.
    const closing = Promise.resolve().then(() => stream.return());
    closing.catch(() => {});
    if (!signal.aborted) await awaitProvider(signal, () => closing);
  }
}

async function readCatalog(services, includeArchived, signal) {
  check(signal);
  const [records, list, snapshot] = await Promise.all([
    awaitProvider(signal, () => services.sessionQuery.listSessions(signal)),
    awaitProvider(signal, () => services.sessionController.list({}, signal)),
    workspaceSnapshot(services.workspaceController, signal),
  ]);
  check(signal);
  if (records.length > LIMITS.maxSessions || list.items.length > LIMITS.maxSessions || snapshot.items.length > LIMITS.maxWorkspaces)
    throw new SearchError('Catalog exceeds the supported 10000-session / 2000-workspace bound', 503, 'CATALOG_LIMIT');
  const metadata = new Map(list.items.map(row => [row.sessionId, row]));
  const membership = new Map(), roots = new Map();
  const assign = (map, id, workspaceId) => map.set(id, map.has(id) && map.get(id) !== workspaceId ? undefined : workspaceId);
  const workspaces = snapshot.items.map(workspace => {
    for (const id of workspace.sessionIds) assign(membership, id, workspace.workspaceId);
    const root = pathKey(workspace.path); if (root) assign(roots, root, workspace.workspaceId);
    return {id: workspace.workspaceId, title: workspace.title.slice(0, 512)};
  });
  const archived = new Set(snapshot.archivedSessionIds);
  const rows = [], seen = new Set();
  for (const {header} of records) {
    check(signal);
    if (seen.has(header.id)) continue;
    seen.add(header.id);
    const row = metadata.get(header.id), isArchived = archived.has(header.id);
    if (header.origin === 'subagent' || row?.origin === 'subagent' || row?.blank || (!includeArchived && isArchived)) continue;
    rows.push({id: header.id, title: row?.projections?.values?.title, archived: isArchived, updatedAt: row?.updatedAt ?? header.createdAt ?? 0,
      workspaceId: membership.has(header.id) ? membership.get(header.id) : roots.get(pathKey(row?.cwd ?? header.cwd))});
  }
  const missing = rows.filter(row => row.title == null);
  for (let offset = 0; offset < missing.length; offset += 128) {
    check(signal);
    const titles = await awaitProvider(signal, () => services.sessionQuery.readTitleSnapshots(missing.slice(offset, offset + 128).map(row => row.id), signal));
    const byId = new Map(titles.filter(result => result.status === 'fulfilled').map(result => [result.sessionId, result.value.title?.title]));
    for (const row of missing.slice(offset, offset + 128)) row.title = byId.get(row.id);
    await yieldTask();
  }
  for (const row of rows) row.title = typeof row.title === 'string' ? row.title : '';
  rows.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {workspaces, rows};
}

// Scan the tail directly and persist only an array index and turn eligibility,
// never a materialized text document list. A completed end makes exactly its
// last assistant message eligible; even an interrupted/tool-call last message
// consumes eligibility so earlier commentary cannot become a false final.
function documentAt(events, index, position) {
  const event = events[index], data = event.data;
  if (event.type === 'turn/start') position.turn = null;
  if (event.type === 'turn/end') position.turn = data.reason?.kind === 'completed' ? data.turn : null;
  if (event.type === 'user/message' && data.source?.kind === 'user')
    return {seq: event.seq, time: event.time, role: 'user', text: textOf(data.content)};
  if (event.type !== 'assistant/message' || position.turn == null || data.turn !== position.turn) return null;
  position.turn = null;
  if (data.interrupted) return null;
  const content = data.message?.content;
  if (!Array.isArray(content) || content.some(block => block.type === 'tool-call')) return null;
  return {seq: event.seq, time: event.time, role: 'assistant', text: textOf(content)};
}

// Domain live logs are append-only and each observation is an immutable cut.
// Resume the original cut, not new appends: no retained lease or copied event log.
// Cold revisions/source transitions still fail explicitly; constant-size seq anchors
// also reject truncation or shifted cut/unread boundaries without a prefix scan.
function resumeEvents(observation, events, position) {
  const version = {source: observation.source ?? null, cursor: observation.cursor,
    revision: observation.revision ?? null, length: events.length};
  if (position.version !== null) {
    const previous = position.version;
    const sameVersion = JSON.stringify(previous) === JSON.stringify(version);
    const liveAppend = previous.source === 'live' && version.source === 'live'
      && JSON.stringify(previous.revision) === JSON.stringify(version.revision)
      && version.length >= previous.length && version.cursor >= previous.cursor;
    if ((!sameVersion && !liveAppend) || events[position.cutoff.index]?.seq !== position.cutoff.seq
      || (position.event >= 0 && events[position.event]?.seq !== position.nextSeq))
      throw new SearchError('History changed during pagination; search again', 409, 'HISTORY_CHANGED');
  } else {
    position.event = events.length - 1;
    position.cutoff = {index: position.event, seq: events[position.event]?.seq ?? null};
  }
  position.version = version;
}

const freshPosition = () => ({event: null, titleDone: false, turn: null, version: null, cutoff: null, nextSeq: null});

export function createSearchService(services, options = {}) {
  const limits = {...LIMITS, ...options};
  const cursors = new Map(), busy = new Set();
  let bytes = 0, active = 0, disposed = false;
  const lifetime = new AbortController();
  const remove = token => {const entry = cursors.get(token); if (entry) {bytes -= entry.bytes; cursors.delete(token);}};
  const prune = () => {
    for (const [token, entry] of cursors) if (entry.expires <= Date.now()) remove(token);
    while (cursors.size > limits.maxCursors || bytes > limits.cacheBytes) remove(cursors.keys().next().value);
  };
  const save = state => {
    const size = Buffer.byteLength(JSON.stringify(state));
    if (size > limits.cacheBytes) throw new SearchError('Search snapshot exceeds cache bound; narrow the scope', 503, 'CACHE_LIMIT');
    const token = randomUUID();
    cursors.set(token, {state, bytes: size, expires: Date.now() + limits.cursorTtlMs}); bytes += size; prune(); return token;
  };
  const signalFor = signal => signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const beginOperation = signal => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new SearchError('搜索批次超时，请缩小工作区或重试', 504, 'SEARCH_TIMEOUT')), limits.operationTimeoutMs);
    return {signal: AbortSignal.any([signal, deadline.signal]), finish() {clearTimeout(timer); deadline.abort();}};
  };
  return {
    async catalog(signal) {
      signal = signalFor(signal); check(signal);
      const operation = beginOperation(signal); signal = operation.signal;
      try {
        const {rows, workspaces} = await readCatalog(services, false, signal);
        check(signal);
        return {workspaces, sessions: rows.map(({id, title, archived, workspaceId}) => ({id, title: title.slice(0, 512), archived, ...(workspaceId ? {workspaceId} : {})}))};
      } finally {operation.finish();}
    },
    async search(raw, signal) {
      const input = validateInput(raw); signal = signalFor(signal); check(signal); prune();
      if (disposed) throw new SearchError('Search service disposed', 503);
      if (active >= limits.maxConcurrent) throw new SearchError('Too many concurrent searches; retry shortly', 429, 'SEARCH_BUSY');
      let state;
      if (input.cursor) {
        const entry = cursors.get(input.cursor);
        if (!entry) throw new SearchError('Search cursor expired; search again', 410, 'CURSOR_EXPIRED');
        if (entry.state.key !== keyOf(input)) throw new SearchError('Cursor does not match query and scope', 400, 'CURSOR_MISMATCH');
        if (busy.has(input.cursor)) throw new SearchError('Cursor is already in use', 409, 'CURSOR_BUSY');
        state = {...entry.state, position: {...entry.state.position}, warnings: [...entry.state.warnings]};
        busy.add(input.cursor);
      }
      const operation = beginOperation(signal); signal = operation.signal;
      active++;
      try {
        if (!state) {
          const {rows, workspaces} = await readCatalog(services, input.includeArchived, signal);
          if (input.workspaceId && !workspaces.some(row => row.id === input.workspaceId)) throw new SearchError('Workspace is unavailable');
          if (input.sessionId && !rows.some(row => row.id === input.sessionId)) throw new SearchError('Session is unavailable or excluded');
          if (input.sessionId && input.workspaceId && rows.find(row => row.id === input.sessionId).workspaceId !== input.workspaceId)
            throw new SearchError('Session does not belong to selected workspace');
          state = {key: keyOf(input), rows: rows.filter(row => (!input.sessionId || row.id === input.sessionId) && (!input.workspaceId || row.workspaceId === input.workspaceId)),
            workspaces, session: 0, scanned: 0, position: freshPosition(), warnings: []};
          const preferred = state.rows.findIndex(row => row.id === input.preferredSessionId);
          if (preferred > 0) state.rows.unshift(...state.rows.splice(preferred, 1));
        }
        const items = [];
        let sessions = 0, visited = 0;
        while (state.session < state.rows.length && items.length < limits.pageSize && sessions < limits.sessionsPerPage && visited < limits.eventsPerPage) {
          check(signal);
          const row = state.rows[state.session], position = state.position;
          const common = {sessionId: row.id, title: row.title.slice(0, 512), archived: row.archived, ...(row.workspaceId ? {workspaceId: row.workspaceId,
            workspaceTitle: state.workspaces.find(workspace => workspace.id === row.workspaceId)?.title} : {})};
          if (!position.titleDone) {
            const match = await literalSnippet(row.title, input.query, signal); position.titleDone = true;
            if (match) items.push({...common, id: row.id + ':title', kind: 'title', ...match});
            if (items.length >= limits.pageSize) break;
          }
          let finished = false;
          try {
            const observation = await awaitProvider(signal,
              () => services.sessionQuery.observeSession(row.id, {signal, projectionMode: 'none'}),
              late => late[Symbol.dispose]());
            try {
              check(signal);
              const events = observation.events;
              resumeEvents(observation, events, position);
              while (position.event >= 0 && items.length < limits.pageSize && visited < limits.eventsPerPage) {
                check(signal);
                const document = documentAt(events, position.event--, position); visited++;
                if (document?.text) {
                  const match = await literalSnippet(document.text, input.query, signal);
                  if (match) items.push({...common, id: row.id + ':message:' + document.seq, kind: 'message', seq: document.seq,
                    ...(document.time !== undefined ? {time: document.time} : {}), role: document.role, ...match});
                }
                if (visited % 64 === 0) {await yieldTask(); check(signal);}
              }
              finished = position.event < 0;
              position.nextSeq = finished ? null : events[position.event].seq;
            } finally {observation[Symbol.dispose]();}
          } catch (error) {
            check(signal);
            if (error instanceof SearchError) throw error;
            if (state.warnings.length < limits.maxWarnings) state.warnings.push({sessionId: row.id, code: 'SESSION_UNAVAILABLE', message: 'Session history could not be read'});
            finished = true;
          }
          if (finished) {state.session++; state.scanned++; sessions++; state.position = freshPosition();}
          else break;
          await yieldTask();
        }
        check(signal);
        const cursor = state.session < state.rows.length ? save(state) : null;
        if (input.cursor) remove(input.cursor);
        return {items, cursor, scanned: state.scanned, totalSessions: state.rows.length, warnings: state.warnings, workspaces: state.workspaces};
      } finally {operation.finish(); active--; if (input.cursor) busy.delete(input.cursor);}
    },
    dispose() {disposed = true; lifetime.abort(); cursors.clear(); bytes = 0;},
  };
}
