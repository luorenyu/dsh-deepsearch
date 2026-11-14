import {createSearchService, SearchError} from './search-core.js?deepsearch=0.1.12';

export const inject = ['sessionQuery', 'sessionController', 'workspaceController', 'connection'];
export const MAX_BODY_BYTES = 16 * 1024;

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...extraHeaders,
  }});
}

export async function readJson(request) {
  request.signal.throwIfAborted();
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? ''))
    throw new SearchError('application/json content type required', 415, 'UNSUPPORTED_MEDIA_TYPE');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES))
    throw new SearchError('JSON body exceeds 16 KiB or has invalid Content-Length', 413, 'BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new SearchError('JSON body required');
  const chunks = []; let length = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new SearchError('JSON body exceeds 16 KiB', 413, 'BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  request.signal.throwIfAborted();
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));}
  catch {throw new SearchError('Invalid JSON body');}
}

export function apply(ctx) {
  const service = createSearchService(ctx);
  // Host performs Host/Origin, authentication and owner checks before fetch,
  // and binds route registration cleanup to the plugin owner effect.
  const handler = (method, operation) => async request => {
    if (request.method !== method) return json({error: method + ' required', code: 'METHOD_NOT_ALLOWED'}, 405, {Allow: method});
    try {return json(await operation(request));}
    catch (error) {
      if (request.signal.aborted || error?.name === 'AbortError') return json({error: 'Search cancelled', code: 'CANCELLED'}, 499);
      if (error instanceof SearchError) return json({error: error.message, code: error.code}, error.status);
      return json({error: 'History service unavailable', code: 'SERVICE_UNAVAILABLE'}, 503);
    }
  };
  ctx.connection.fetch.register({path: '/api/deepsearch/search', methods: ['POST'], requestBody: 'buffered',
    fetch: handler('POST', async request => service.search(await readJson(request), request.signal))});
  ctx.connection.fetch.register({path: '/api/deepsearch/catalog', methods: ['GET'], requestBody: 'buffered',
    fetch: handler('GET', request => service.catalog(request.signal))});
  // Abort in-flight operations and discard cursor metadata on plugin unload.
  ctx.effect(() => () => service.dispose());
}
