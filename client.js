window.__ModuleLoader__.load({
  id: '@renyuluo/dsh-deepsearch',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const {StateDot} = require('@deepseek-ai/dsh-client-ui-primitives');
    const MAX_RESULTS = 200;
    // Bounded compatibility adapter: native navigation first, exact sidebar rows second.
    function revealProject(ctx, workspaceId, start) {
      const sources = [ctx.sessions?.list, ctx.workspaces?.list, ctx.layout?.panelInfo];
      if (!document.querySelectorAll || sources.some(source => !source?.subscribe)) {start(); return () => {};}
      let stopped = false, timer, deadline, observer, selectedId;
      const disposers = [], clicked = new WeakSet();
      const mainIds = () => Object.values(sources[0].getSnapshot().byId || {}).filter(row => (row.retainedBy?.mainView || 0) > 0).map(row => row.id);
      const initial = new Set(mainIds());
      const stop = () => {
        if (stopped) return; stopped = true; clearTimeout(timer); clearTimeout(deadline); observer?.disconnect();
        for (const dispose of disposers.splice(0)) dispose();
        for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.removeEventListener(name, interrupt, true);
      };
      const interrupt = event => {if (event.isTrusted) stop();};
      const schedule = () => {if (!stopped) {clearTimeout(timer); timer = setTimeout(check, 0);}};
      const findRow = key => Array.from(document.querySelectorAll('[data-row-key][role="treeitem"]')).find(row => row.getAttribute('data-row-key') === key && row.getClientRects().length);
      function check() {
        if (stopped) return;
        try {
          const snapshot = sources[1].getSnapshot(), items = snapshot.items || [], target = items.find(row => row.workspaceId === workspaceId);
          const ids = mainIds(), rows = sources[0].getSnapshot().byId || {};
          if (selectedId && (ids.length !== 1 || ids[0] !== selectedId)) {stop(); return;}
          if (!target || snapshot.phase !== 'ready') return;
          const id = ids.length === 1 && target.sessionIds?.includes(ids[0]) && rows[ids[0]]?.blank === true ? ids[0] : undefined;
          if (!id) {if (ids.some(value => !initial.has(value) && !target.sessionIds?.includes(value))) stop(); return;}
          if (sources[2].getSnapshot().activePanelId !== null) return;
          selectedId = id;
          let row = findRow('workspace:' + workspaceId);
          if (!row) {
            // A missing child can be behind collapsed path ancestors; flat mode skips this branch.
            const normalize = path => (/^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '');
            const path = typeof target.path === 'string' ? normalize(target.path) : '';
            const parents = path ? items.filter(item => item.workspaceId !== workspaceId && typeof item.path === 'string' && path.startsWith(normalize(item.path) + '/')).sort((a, b) => normalize(a.path).length - normalize(b.path).length) : [];
            row = parents.map(parent => findRow('workspace:' + parent.workspaceId)).find(parent => parent?.getAttribute('aria-expanded') === 'false');
            if (!row) return;
          }
          if (row.getAttribute('aria-expanded') === 'false') {
            if (!clicked.has(row)) {clicked.add(row); row.click(); schedule();}
            return;
          }
          const sessionRow = findRow('session:' + id);
          if (!sessionRow) return;
          // Adjust only sidebar ancestors, inner first; never scroll the conversation/document.
          const scrollers = [];
          for (let node = row.parentElement; node && node !== document.body; node = node.parentElement) {
            if (node.scrollHeight > node.clientHeight && (/^(auto|scroll)$/.test(window.getComputedStyle(node).overflowY) || node.hasAttribute?.('data-sidebar-list-area') || node.hasAttribute?.('data-sidebar-scrollport'))) scrollers.push(node);
          }
          stop();
          for (const scroller of scrollers) {
            const bounds = scroller.getBoundingClientRect(), header = row.getBoundingClientRect(), session = sessionRow.getBoundingClientRect();
            const bottom = session.bottom - header.top <= scroller.clientHeight ? session.bottom : header.bottom;
            const delta = header.top < bounds.top ? header.top - bounds.top : bottom > bounds.bottom ? bottom - bounds.bottom : 0;
            if (delta) scroller.scrollTop += delta;
          }
        } catch {stop();} // A changed host DOM must not break navigation.
      }
      try {
        for (const source of sources) disposers.push(source.subscribe(schedule));
        if (typeof MutationObserver !== 'undefined') {observer = new MutationObserver(schedule); observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-selected']});}
        deadline = setTimeout(stop, 8000);
        for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.addEventListener(name, interrupt, true);
      } catch {stop();}
      try {start(); schedule();} catch (error) {stop(); throw error;}
      return stop;
    }
    function selectedKeys(chat, seq) {
      if (!Number.isSafeInteger(seq) || !chat?.order || !chat.nodes?.get) return [];
      return chat.order.filter(key => {
        const node = chat.nodes.get(key);
        return node && [node.anchorSeq, node.data?.seq, node.data?.finalNode?.seq, node.data?.root?.seq].includes(seq);
      });
    }
    async function loadExact(reference, seq, isCurrent, signal) {
      if (signal?.aborted) return false;
      const connected = await new Promise((resolve, reject) => {
        const finish = (value, error) => {clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(value);};
        const cancel = () => finish(false);
        const timer = setTimeout(() => finish(false, new Error('会话连接超时，请重试')), 10000);
        signal?.addEventListener('abort', cancel, {once: true});
        reference.ready.then(() => finish(true), error => finish(false, error));
      });
      if (!connected || !isCurrent() || signal?.aborted) return false;
      const binding = reference.binding, session = binding.session;
      const contains = () => binding.eventSource.getSnapshot().entries.some(entry => entry.type === 'event' && entry.event.seq === seq);
      if (contains()) return true;
      return new Promise((resolve, reject) => {
        let disposed = false, running = false, attempts = 0, unsubscribe, retryTimer;
        const finish = (error) => {
          if (disposed) return; disposed = true; clearTimeout(timer); clearTimeout(retryTimer); unsubscribe?.(); signal?.removeEventListener('abort', cancel);
          error ? reject(error) : resolve(!signal?.aborted && isCurrent());
        };
        const cancel = () => finish();
        const timer = setTimeout(() => finish(new Error('历史未能加载到命中消息，请重试或手动查看')), 10000);
        signal?.addEventListener('abort', cancel, {once: true});
        async function check() {
          if (disposed) return;
          if (!isCurrent()) {finish(); return;}
          if (contains()) {finish(); return;}
          if (running || session.getSnapshot().loadingOlder || attempts >= 4) return;
          running = true; attempts++;
          try {
            await session.loadThrough(seq);
            if (disposed) return;
            if (contains()) finish();
            else if (!session.getSnapshot().hasMore) finish(new Error('历史中找不到原命中消息；它可能已被撤回或改写'));
          } catch (failure) {finish(failure);}
          finally {running = false; if (!disposed && attempts < 4) retryTimer = setTimeout(check, 150);}
        }
        unsubscribe = session.subscribe(check); check();
      });
    }
    function isShortcut(event) {
      return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey &&
        event.key.toLowerCase() === 'k' && !event.isComposing && !event.repeat;
    }
    const SHORTCUT_KEY = 'dsh-deepsearch.shortcut-takeover.v1';
    function createShortcutTakeover(service, storage, toggle) {
      const id = 'deepsearch.toggle', nativeId = 'session.search', key = {code: 'KeyK', modifiers: ['meta']};
      const profile = 'desktop:macos', listeners = new Set(), disposers = [];
      let busy = false, error = '', journal = null, disposed = false, state;
      let supported = service?.runtime === 'desktop' && service?.platform === 'macos' && typeof service.edit === 'function', invalidBackup = false;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const override = command => {
        const values = service.config.getSnapshot().document.profiles[profile] || {};
        return Object.hasOwn(values, command) ? {present: true, value: values[command]} : {present: false};
      };
      const cleared = {present: true, value: null}, assigned = {present: true, value: key};
      const ownsKey = binding => binding?.code === 'KeyK' && !binding.secondCode && binding.modifiers?.length === 1 && binding.modifiers[0] === 'meta';
      const publish = () => {
        const rows = service?.catalog?.getSnapshot() || [], own = rows.find(row => row.id === id), native = rows.find(row => row.id === nativeId);
        state = {supported, busy, error, recovery: !!journal, enabled: !!(ownsKey(own?.binding) && native?.binding === null && !own?.conflicts?.length && !own?.issue)};
        for (const listener of listeners) listener();
      };
      const readJournal = () => {
      journal = null; invalidBackup = false;
      try {const raw = storage?.getItem(SHORTCUT_KEY); if (raw) {
        const value = JSON.parse(raw);
        const valid = entry => {
          if (!entry || typeof entry.present !== 'boolean') return false;
          if (!entry.present || entry.value === null) return true;
          const binding = entry.value;
          if (!binding || Object.keys(binding).some(key => !['code','secondCode','modifiers'].includes(key)) || typeof binding.code !== 'string' ||
            (Object.hasOwn(binding, 'secondCode') && typeof binding.secondCode !== 'string') || !Array.isArray(binding.modifiers) ||
            !binding.modifiers.every(value => ['primary','control','alt','shift','meta'].includes(value))) return false;
          // The public host normalizer rejects unsupported/duplicate physical codes before any write.
          try {service.describeBinding(binding); return true;} catch {return false;}
        };
        if (value?.profile === profile && valid(value.native) && valid(value.own)) journal = value;
        else {invalidBackup = true; error = '快捷键备份无法识别，请先在 DSH 快捷键设置中检查原生会话搜索。';}
      }} catch {invalidBackup = true; error = '无法读取快捷键备份；未修改 DSH 配置。';}
      };
      readJournal();
      try {
        if (supported) {
          disposers.push(service.register({id, label: () => 'DeepSearch 全文搜索', aliases: ['DeepSearch'], defaults: {}, regions: ['page', 'editable'], modals: ['sidebar'],
            resolve: () => ({status: 'handled', run: () => {if (!disposed) toggle();}})}));
          disposers.push(service.config.subscribe(publish), service.catalog.subscribe(publish));
          if (typeof window !== 'undefined' && window.addEventListener) {
            const onStorage = event => {if (!busy && (event.key === SHORTCUT_KEY || event.key === null)) {readJournal(); publish();}};
            window.addEventListener('storage', onStorage);
            disposers.push(() => window.removeEventListener('storage', onStorage));
          }
        }
      } catch {supported = false; for (const off of disposers.splice(0)) off(); error = '无法注册 DeepSearch 快捷键命令。';}
      publish();
      const edit = async (command, value) => {
        if (disposed) throw new Error('插件已卸载，请在 DSH 快捷键设置中恢复原绑定。');
        const snapshot = service.config.getSnapshot();
        if (snapshot.status !== 'ready') throw new Error('DSH 快捷键配置尚未就绪，请稍后重试。');
        const result = await service.edit(value.present ? {type: 'set', id: command, binding: value.value} : {type: 'reset', id: command}, snapshot.revision);
        if (result.status !== 'saved') throw new Error('DSH 快捷键保存失败（' + result.status + '），请检查配置后重试。');
      };
      const restore = async () => {
        if (!journal) throw new Error('缺少原快捷键备份，请到 DSH 快捷键设置中手动恢复会话搜索。');
        const previous = journal;
        if (![previous.native, cleared].some(value => same(value, override(nativeId))) || ![previous.own, assigned].some(value => same(value, override(id))))
          throw new Error('相关快捷键已被其他设置修改；为避免覆盖，请在 DSH 快捷键设置中手动恢复。');
        if (!same(override(id), previous.own)) await edit(id, previous.own);
        if (!same(override(nativeId), previous.native)) {
          if (!same(override(nativeId), cleared)) throw new Error('原生搜索绑定已变化，已停止恢复，未覆盖新配置。');
          await edit(nativeId, previous.native);
        }
        if (!same(override(nativeId), previous.native) || !same(override(id), previous.own)) throw new Error('恢复期间快捷键配置已变化，请检查 DSH 设置，备份已保留。');
        if (!same(JSON.parse(storage.getItem(SHORTCUT_KEY)), previous)) throw new Error('快捷键恢复备份已被其他窗口修改，已保留新的备份。');
        storage.removeItem(SHORTCUT_KEY); journal = null;
      };
      return {
        getSnapshot: () => state,
        subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
        async setEnabled(value) {
          if (!supported || disposed || busy) return;
          busy = true; error = ''; publish();
          const perform = async () => {try {
            // Another window may have taken over since this controller was mounted.
            readJournal();
            if (!value) await restore();
            else {
              if (invalidBackup) throw new Error('快捷键备份不可用，未修改 DSH 配置；请检查本机存储及 DSH 快捷键设置。');
              if (journal) throw new Error('存在待恢复的快捷键备份，请先点击恢复原绑定。');
              const snapshot = service.config.getSnapshot();
              if (snapshot.status !== 'ready') throw new Error('DSH 快捷键配置尚未就绪。');
              const conflicts = service.describeBinding(key);
              if (conflicts.issue || conflicts.conflicts.some(command => command !== nativeId && command !== id)) throw new Error('⌘K 已被其他命令占用，请先在 DSH 快捷键设置中处理冲突。');
              const previous = {profile, native: override(nativeId), own: override(id)};
              // Persist recovery data before the first host write; never silently lose the old binding.
              storage.setItem(SHORTCUT_KEY, JSON.stringify(previous)); journal = previous;
              try {
                await edit(nativeId, cleared);
                if (!same(override(nativeId), cleared) || !same(override(id), previous.own)) throw new Error('快捷键配置已变化，停止接管。');
                await edit(id, assigned);
              } catch (failure) {
                try {await restore();} catch (recovery) {throw new Error(failure.message + ' ' + recovery.message);}
                throw failure;
              }
            }
          } catch (failure) {error = failure.message || '快捷键设置失败，未完成接管。';}
          finally {busy = false; publish();}};
          // Serialize renderer windows sharing this origin, including recovery journal ownership.
          if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            try {await navigator.locks.request(SHORTCUT_KEY, perform);} catch {busy = false; error = '无法锁定快捷键配置，请重试。'; publish();}
          } else await perform();
        },
        dispose() {disposed = true; for (const off of disposers.splice(0)) off(); listeners.clear();},
      };
    }
    function joinItems(previous, next) {
      const seen = new Set(previous.map(item => item.id));
      return previous.concat(next.filter(item => !seen.has(item.id) && seen.add(item.id))).slice(0, MAX_RESULTS);
    }
    function currentSessionId(binding, snapshot) {
      return binding?.key ?? Object.values(snapshot?.byId || {}).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
    }
    function pauseScan(signal) {
      return new Promise((resolve, reject) => {
        const cancel = () => {clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason);};
        const timer = setTimeout(() => {signal.removeEventListener('abort', cancel); resolve();}, 20);
        signal.addEventListener('abort', cancel, {once: true}); if (signal.aborted) cancel();
      });
    }
    async function scanPages({requestPage, onPage, isCurrent, signal, cursor, initialItems = [], yieldPage = pauseScan}) {
      let items = initialItems, warnings = [];
      do {
        if (signal.aborted || !isCurrent()) return;
        const page = await requestPage(cursor, signal);
        if (signal.aborted || !isCurrent()) return;
        const incoming = page.items || [], uniqueCount = new Set(items.concat(incoming).map(item => item.id)).size;
        items = joinItems(items, incoming); cursor = page.cursor;
        warnings = [...new Map(warnings.concat(page.warnings || []).map(warning => [JSON.stringify(warning), warning])).values()].slice(0, 32);
        onPage({...page, items, warnings, capped: uniqueCount > MAX_RESULTS || (items.length >= MAX_RESULTS && !!cursor)});
        if (!cursor || items.length >= MAX_RESULTS) return;
        await yieldPage(signal);
      } while (true);
    }
    function searchStatus({busy, error, result, query, projects = false}) {
      if (projects || !query) return {empty: query ? '没有找到匹配项目' : '把记得的那句话交给 DeepSearch', footer: '⌘⇧K / Ctrl⇧K'};
      const progress = (result.items?.length || 0) + ' 条 · 已扫描 ' + result.scanned + '/' + result.totalSessions;
      if (busy) return {empty: '正在查找对话内容', footer: '搜索中 · ' + progress};
      if (error) return {empty: '搜索未完成', footer: '搜索中断 · ' + progress};
      if (result.capped || result.cursor) return {empty: '搜索尚未完成', footer: (result.capped || result.items.length >= MAX_RESULTS ? '已达 200 条上限，请缩小范围 · ' : '等待继续 · ') + progress};
      if (result.warnings?.length) return {empty: '部分历史读取失败，无法确认没有匹配', footer: '部分完成 · ' + progress};
      return {empty: '没有找到匹配内容', footer: '搜索完成 · ' + progress};
    }
    // Transform context separately so the exact UTF-16 match is never lost to clipping.
    function matchPreview(text = '', range) {
      const compact = value => value.replace(/\s+/gu, ' ');
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) || range[0] < 0 || range[1] <= range[0] || range[1] > text.length) {
        const points = Array.from(compact(text));
        return {text: points.slice(0, 96).join('') + (points.length > 96 ? '…' : ''), range: null};
      }
      const before = Array.from(compact(text.slice(0, range[0]))), after = Array.from(compact(text.slice(range[1])));
      const prefix = (before.length > 32 ? '…' : '') + before.slice(-32).join('');
      const hit = text.slice(...range);
      return {text: prefix + hit + after.slice(0, 64).join('') + (after.length > 64 ? '…' : ''), range: [prefix.length, prefix.length + hit.length]};
    }
    const APPEARANCE_KEY = 'dsh-deepsearch.appearance.v1';
    function formatMessageTime(value) {
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      if (typeof value === 'string') {
        const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
        if (!parts) return null;
        const [,year,month,day,hour,minute,second,offsetHour = 0,offsetMinute = 0] = parts.map(Number);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
        if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
      }
      const date = new Date(value); if (!Number.isFinite(date.getTime())) return null;
      const pad = n => String(n).padStart(2, '0');
      return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }
    function appearancePrefs(value) {
      const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
      return {mode: ['glass','theme','custom'].includes(value?.mode) ? value.mode : 'glass',
        color: typeof value?.color === 'string' && /^#[a-f0-9]{6}$/i.test(value.color) ? value.color : '#edf2f7',
        opacity: number(value?.opacity, 88, 55, 100), blur: number(value?.blur, 18, 0, 32)};
    }
    function readAppearance(storage) {
      try {const raw = storage.getItem(APPEARANCE_KEY); return appearancePrefs(raw?.length > 2048 ? null : JSON.parse(raw));} catch {return appearancePrefs(null);}
    }
    function saveAppearance(storage, value) {
      try {storage.setItem(APPEARANCE_KEY, JSON.stringify(appearancePrefs(value))); return true;} catch {return false;}
    }
    function appearanceStyle(value) {
      const prefs = appearancePrefs(value);
      if (prefs.mode === 'theme') return {'--ds-surface':'var(--ds-bg)', '--ds-blur':'0px', '--ds-filter':'none'};
      // Reuse the native composer material when available, not the transparent canvas token.
      const style = {'--ds-surface':'var(--dsw-specific-input-major, color-mix(in srgb, var(--ds-bg) 65%, transparent))', '--ds-blur':prefs.blur + 'px',
        '--ds-filter':'blur(var(--ds-blur)) saturate(var(--we-saturate,1.3)) brightness(var(--we-glass-brightness,1.04)) contrast(1.01)'};
      if (prefs.mode === 'custom') {
        const rgb = [1,3,5].map(i => parseInt(prefs.color.slice(i,i+2),16));
        const light = rgb[0]*.299 + rgb[1]*.587 + rgb[2]*.114 > 150;
        Object.assign(style, {'--ds-bg':prefs.color, '--ds-surface':'rgba(' + rgb.join(',') + ',' + prefs.opacity/100 + ')',
          '--ds-text':light ? '#14202f' : '#f4f7fc', '--ds-muted':light ? '#455368' : '#c5d0df',
          '--ds-hover':light ? '#0000000b' : '#ffffff17', '--ds-line':light ? '#00000022' : '#ffffff30'});
      }
      return style;
    }
    const HISTORY_KEY = 'dsh-deepsearch.search-history.v1';
    function createSearchHistory(storage) {
      const normalize = value => {
        const seen = new Set(), entries = [];
        for (const item of (Array.isArray(value?.entries) ? value.entries.slice(0, 1000) : [])) {
          const query = typeof item?.query === 'string' ? item.query.trim() : '';
          if (!query || query.length > 256 || seen.has(query) || typeof item.time !== 'number' || !Number.isFinite(item.time) || item.time <= 0 || !Number.isFinite(new Date(item.time).getTime())) continue;
          seen.add(query); entries.push({query, time: item.time});
        }
        entries.sort((a, b) => b.time - a.time);
        return {defaultHistory: value?.defaultHistory === true, entries: entries.slice(0, 30), error: ''};
      };
      const read = () => {const raw = storage?.getItem(HISTORY_KEY); if (raw?.length > 200000) throw new Error(); return normalize(JSON.parse(raw || 'null'));};
      let state; try {state = read();} catch {state = {...normalize(null), error: '无法读取搜索历史；本次记录仅在内存中可用。'};}
      const listeners = new Set(), notify = () => {for (const listener of listeners) listener();};
      const commit = value => {
        state = normalize(value);
        try {if (!storage) throw new Error(); storage.setItem(HISTORY_KEY, JSON.stringify({defaultHistory: state.defaultHistory, entries: state.entries}));}
        catch {state = {...state, error: '搜索历史本次已更新，但无法保存到本机；刷新或重启后可能丢失。'};}
        notify();
      };
      return {
        getSnapshot: () => state,
        subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
        add(value) {
          const query = typeof value === 'string' ? value.trim() : '';
          if (!query || query.length > 256) return;
          commit({...state, entries: [{query, time: Date.now()}, ...state.entries.filter(item => item.query !== query)]});
        },
        remove: query => commit({...state, entries: state.entries.filter(item => item.query !== query)}),
        clear: () => commit({...state, entries: []}),
        setDefault: value => commit({...state, defaultHistory: value === true}),
        reload() {try {state = read();} catch {state = {...state, error: '无法读取更新的搜索历史，已保留当前记录。'};} notify();},
      };
    }
    // Independent, local-only reminders: never mutate the host's completionUnread status.
    const UNREAD_KEY = 'dsh-deepsearch.manual-unread.v1';
    function unreadPrefs(value) {
      return {enabled: value?.enabled === true, ids: [...new Set(Array.isArray(value?.ids)
        ? value.ids.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 512).slice(0, 10000) : [])]};
    }
    function createUnreadStore(storage) {
      let state;
      try {const raw = storage?.getItem(UNREAD_KEY); state = unreadPrefs(raw?.length > 6e6 ? null : JSON.parse(raw));}
      catch {state = unreadPrefs(null);}
      let active = new Set(), error = '';
      const listeners = new Set();
      const notify = () => {for (const listener of listeners) listener();};
      const commit = next => {
        state = unreadPrefs(next);
        try {storage?.setItem(UNREAD_KEY, JSON.stringify(state)); if (!storage) throw new Error(); error = '';}
        catch {error = '本次已生效，但无法保存到本机；刷新或重启后可能丢失。';}
        notify();
      };
      return {
        getSnapshot: () => state,
        subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener);},
        getError: () => error,
        setEnabled: enabled => commit({...state, enabled}),
        mark: (id, unread) => {
          if (!state.enabled || typeof id !== 'string' || !id || id.length > 512) return;
          commit({...state, ids: unread ? state.ids.concat(id) : state.ids.filter(item => item !== id)});
        },
        observeActive: ids => {
          const next = new Set(ids), entered = [...next].filter(id => !active.has(id)); active = next;
          if (state.enabled && entered.some(id => state.ids.includes(id))) commit({...state, ids: state.ids.filter(id => !entered.includes(id))});
        },
        primeActive: ids => {active = new Set(ids);},
        reload: () => {
          try {const raw = storage?.getItem(UNREAD_KEY); state = unreadPrefs(raw?.length > 6e6 ? null : JSON.parse(raw)); error = ''; notify();} catch {}
        },
      };
    }
    function installUnread(ctx, store) {
      const activeIds = () => Object.values(ctx.sessions.list.getSnapshot()?.byId || {})
        .filter(row => (row.retainedBy?.mainView ?? 0) > 0).map(row => row.id);
      store.primeActive(activeIds());
      const stopSessions = ctx.sessions.list.subscribe(() => store.observeActive(activeIds()));
      const unmenu = ctx.contextMenus.register({id: 'deepsearch.manual-unread', target: 'session', order: 350,
        observe: () => [store],
        resolve: ({sessionId}) => {
          const state = store.getSnapshot(); if (!state.enabled) return [];
          const unread = state.ids.includes(sessionId);
          return [{id: 'deepsearch-toggle-unread', label: unread ? '标记为已读' : '标记为未读',
            run: () => store.mark(sessionId, !unread)}];
        }});
      const onStorage = event => {if (event.key === UNREAD_KEY || event.key === null) store.reload();};
      window.addEventListener('storage', onStorage);
      return () => {
        stopSessions(); unmenu();
        window.removeEventListener('storage', onStorage);
      };
    }
    function Icon({folder = false}) {
      return h('svg', {width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true},
        folder ? h('path', {d: 'M3 6h6l2 3h10v11H3z'}) : h(React.Fragment, null, h('circle', {cx: 10.5, cy: 10.5, r: 6.7}), h('path', {d: 'm16 16 5 5'})));
    }
    function Mark({text = '', range}) {
      const preview = matchPreview(text, range);
      if (!preview.range) return preview.text;
      return h(React.Fragment, null, preview.text.slice(0, preview.range[0]), h('mark', null, preview.text.slice(...preview.range)), preview.text.slice(preview.range[1]));
    }
    const css = "\n.deepsearch-panel{--ds-bg:var(--we-panel-color,var(--dsw-alias-bg-base,#fff));--ds-line:var(--dsw-alias-border-l1,#e5e7eb);--ds-text:var(--dsw-alias-label-primary,#18212f);--ds-muted:var(--dsw-alias-label-secondary,#657080);--ds-hover:var(--dsw-alias-bg-layer-2,#f3f5f7);position:fixed;pointer-events:auto;z-index:10000;top:clamp(26px,12vh,128px);left:50%;transform:translateX(-50%);width:min(700px,calc(100vw - 32px));max-height:calc(100vh - clamp(26px,12vh,128px) - 24px);display:flex;flex-direction:column;color:var(--ds-text);background:var(--ds-bg);background:var(--ds-effective-surface,var(--ds-surface,var(--ds-bg)));backdrop-filter:var(--ds-effective-filter,var(--ds-filter,none));-webkit-backdrop-filter:var(--ds-effective-filter,var(--ds-filter,none));border:1px solid var(--ds-line);border-radius:16px;box-shadow:0 16px 60px #0002,0 2px 8px #0001;font-family:inherit;overflow:hidden;text-align:left;isolation:isolate}\n.deepsearch-panel *{box-sizing:border-box}.deepsearch-panel button,.deepsearch-panel input,.deepsearch-panel select,.deepsearch-jump button{font:inherit;color:inherit}.deepsearch-panel button{cursor:pointer}.deepsearch-panel button:disabled{cursor:default;opacity:.6}.deepsearch-panel button:focus-visible,.deepsearch-panel select:focus-visible,.deepsearch-jump button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3478f6);outline-offset:-2px}.deepsearch-search{display:flex;align-items:center;gap:14px;padding:19px 20px 17px;color:var(--ds-muted)}.deepsearch-search>input{min-width:0;flex:1;border:0;outline:none;background:transparent;font-size:18px;line-height:28px;color:var(--ds-text)}.deepsearch-search>input::placeholder{color:var(--ds-muted);opacity:.8}.deepsearch-escape{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;height:22px;line-height:16px!important;border:1px solid var(--ds-line);border-radius:5px;padding:2px 6px;background:none;font-size:11px!important;color:var(--ds-muted)!important}.deepsearch-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 16px 11px;border-bottom:1px solid var(--ds-line)}.deepsearch-tabs{display:flex;gap:4px}.deepsearch-tabs button{border:0;border-radius:6px;background:none;font-size:12px;padding:6px 12px;color:var(--ds-muted)}.deepsearch-tabs button[aria-selected=true]{background:var(--ds-hover);color:var(--ds-text);font-weight:600}.deepsearch-toolbar select{max-width:190px;min-width:0;border:0;outline:none;background:var(--ds-bg);font-size:11px;color:var(--ds-muted);padding:5px}.deepsearch-caption{display:flex;justify-content:space-between;gap:12px;padding:13px 20px 7px;font-size:11px;color:var(--ds-muted)}.deepsearch-caption label{display:flex;align-items:center;gap:4px;cursor:pointer}.deepsearch-caption input{margin:0;width:12px;height:12px;accent-color:var(--dsw-alias-brand-primary,#3478f6)}.deepsearch-results{overflow-y:auto;overscroll-behavior:contain;max-height:min(440px,50vh);padding:0 8px 8px;scroll-padding:8px;min-height:80px}.deepsearch-result{display:flex;width:100%;gap:12px;align-items:flex-start;border:0;border-radius:8px;background:transparent;padding:12px;text-align:left}.deepsearch-result[aria-selected=true]{background:var(--ds-hover)}.deepsearch-result-icon{color:var(--ds-muted);padding-top:2px;flex:none}.deepsearch-result-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}.deepsearch-result-title{font-size:13px;line-height:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.deepsearch-snippet{font-size:12px;line-height:1.7;color:var(--ds-muted);white-space:pre-wrap;overflow-wrap:anywhere;display:block}.deepsearch-snippet mark{background:#ffe293;color:#382a09;border-radius:2px;padding:0 1px}.deepsearch-meta{font-size:10px;line-height:17px;color:var(--ds-muted);opacity:.85}.deepsearch-return{font-size:14px;align-self:center;color:var(--ds-muted);opacity:0}.deepsearch-result[aria-selected=true] .deepsearch-return{opacity:1}.deepsearch-footer{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--ds-line);padding:12px 20px;color:var(--ds-muted);font-size:10px}.deepsearch-footer strong{font-weight:600;color:var(--ds-text)}.deepsearch-empty{display:flex;align-items:center;flex-direction:column;gap:12px;padding:37px 18px 32px;color:var(--ds-muted)}.deepsearch-empty>svg{width:27px;height:27px;opacity:.5}.deepsearch-empty strong{font-size:13px;font-weight:500;color:var(--ds-text)}.deepsearch-empty p{font-size:11px;margin:0;text-align:center}.deepsearch-error,.deepsearch-warning{padding:8px 20px;font-size:11px;color:var(--ds-text);background:var(--ds-hover)}.deepsearch-error button{margin-left:8px;border:0;background:none;text-decoration:underline}.deepsearch-more{background:transparent;border:0;border-top:1px solid var(--ds-line);padding:10px;font-size:11px;color:var(--ds-muted)}.deepsearch-jump{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;position:relative}.deepsearch-jump-bar{display:flex;align-items:center;gap:12px;padding:9px 18px;flex-shrink:0;border-bottom:1px solid var(--dsw-alias-border-l1,#ddd);font-size:11px;color:var(--dsw-alias-label-secondary,#667);background:var(--dsw-alias-bg-base,#fff)}.deepsearch-jump-bar>span{flex:1}.deepsearch-jump button,.deepsearch-jump-loading button{border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:5px;background:var(--dsw-alias-bg-base,#fff);font:inherit;color:inherit;padding:3px 7px;cursor:pointer}.deepsearch-jump-loading{padding:24px;font:inherit;color:var(--dsw-alias-label-primary,#18212f)}.deepsearch-jump *::highlight(deepsearch-hit){background:#ffe293;color:#382a09}\n@media(max-width:520px){.deepsearch-panel{top:18px;width:calc(100vw - 20px);border-radius:12px}.deepsearch-search{padding:14px;gap:10px}.deepsearch-search>input{font-size:16px}.deepsearch-toolbar{padding:0 10px 10px}.deepsearch-toolbar select{max-width:130px}.deepsearch-caption{padding-left:14px;padding-right:14px}.deepsearch-footer{padding:11px 14px}.deepsearch-key-hint{display:none}.deepsearch-jump-bar{flex-wrap:wrap}}\n";
    const archiveCss = '.deepsearch-archived{display:inline-block;margin-left:8px;padding:1px 5px;border:1px solid var(--ds-line);border-radius:4px;font-size:11px;font-weight:400;color:var(--ds-muted);vertical-align:middle}.deepsearch-confirm{padding:14px 20px;border-top:1px solid var(--ds-line);font-size:13px}.deepsearch-confirm p{margin:6px 0 10px;color:var(--ds-muted)}.deepsearch-confirm button{padding:6px 10px;margin-right:8px;border:1px solid var(--ds-line);border-radius:6px;background:var(--ds-hover)}';
    const appearanceCss = '.deepsearch-appearance{display:flex;flex-wrap:wrap;gap:12px;padding:12px 20px 16px;border-top:1px solid var(--ds-line);font-size:12px}.deepsearch-appearance-controls{display:flex;align-items:center;gap:12px;width:100%;min-width:0;overflow-x:auto}.deepsearch-appearance-controls>*{flex-shrink:0}.deepsearch-appearance label{display:flex;align-items:center;gap:8px;white-space:nowrap}.deepsearch-appearance .deepsearch-reset{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px}.deepsearch-shortcut-help{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.deepsearch-extension>div{min-width:0}.deepsearch-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.deepsearch-appearance select,.deepsearch-appearance button{background:var(--ds-hover);border:1px solid var(--ds-line);border-radius:6px;padding:5px}.deepsearch-appearance input[type=range]{width:100px;accent-color:var(--dsw-alias-brand-primary,#3478f6)}.deepsearch-appearance input[type=color]{width:30px;height:24px;padding:0;border:0;background:none}.deepsearch-appearance p{width:100%;margin:0;color:var(--ds-muted)}/* Wallpaper Engine intentionally solidifies ordinary ARIA dialogs. Only this owned panel opts back into its selected material; never forge its runtime markers or change global settings. */body[data-we-glass-page][data-we-floater-solid] .deepsearch-panel[role=dialog][data-appearance]{background-color:var(--ds-effective-surface,var(--ds-surface,var(--ds-bg)))!important;backdrop-filter:var(--ds-effective-filter,var(--ds-filter,none))!important;-webkit-backdrop-filter:var(--ds-effective-filter,var(--ds-filter,none))!important}@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.deepsearch-panel{--ds-effective-surface:var(--ds-bg);--ds-effective-filter:none}}@media(prefers-reduced-transparency:reduce){.deepsearch-panel{--ds-effective-surface:var(--ds-bg);--ds-effective-filter:none}}';
    const historyCss = '.deepsearch-caption{flex-wrap:wrap;gap:10px}.deepsearch-caption-options{display:flex;align-items:center;gap:14px;margin-left:auto}.deepsearch-empty-tabs{display:flex;gap:12px}.deepsearch-empty-tabs button{font:inherit;padding:0 0 4px;color:var(--ds-muted);border:0;border-bottom:2px solid transparent;border-radius:0;background:none}.deepsearch-empty-tabs button[aria-selected=true]{color:var(--ds-text);border-bottom-color:currentColor}.deepsearch-history-tools{display:flex;justify-content:flex-end;padding:0 20px 6px}.deepsearch-history-tools button,.deepsearch-history-delete{background:none;border:0;color:var(--ds-muted);font:inherit;cursor:pointer}.deepsearch-history-row{padding:0;gap:0}.deepsearch-history-main{min-width:0;flex:1}.deepsearch-history-replay{width:100%;display:flex;align-items:center;gap:14px;min-width:0;flex:1;text-align:left;padding:14px 16px;background:none;border:0;color:inherit;font:inherit;cursor:pointer}.deepsearch-history-delete{flex-shrink:0;padding:12px;font-size:20px}.deepsearch-history-delete:hover{color:var(--ds-text)}.deepsearch-history-replay:focus-visible,.deepsearch-history-delete:focus-visible{outline:2px solid var(--ds-text);outline-offset:-3px;border-radius:6px}';
    const extensionCss = '.deepsearch-extension{width:100%;display:flex;align-items:center;justify-content:space-between;gap:20px;padding-top:14px;border-top:1px solid var(--ds-line)}.deepsearch-extension strong{font-weight:600;font-size:13px}.deepsearch-extension p{margin:5px 0 0;line-height:1.6}.deepsearch-panel .deepsearch-switch{flex-shrink:0;width:38px;height:22px;padding:2px;border:1px solid var(--ds-line);border-radius:20px;background:var(--ds-hover)}.deepsearch-panel .deepsearch-switch[aria-checked=true]{background:#3478f6;border-color:transparent}.deepsearch-switch span{display:block;width:16px;height:16px;border-radius:50%;background:var(--ds-muted)}.deepsearch-switch[aria-checked=true] span{transform:translateX(16px);background:#fff}';
    return {
      inject: ['slots', 'layout', 'uiWorkspace', 'uiSession', 'sessions', 'workspaces', 'contextMenus', 'shortcuts'],
      apply(ctx) {
        let storage; try {storage = window.localStorage;} catch {}
        const historyStore = createSearchHistory(storage);
        ctx.effect(() => {
          const reload = event => {if (event.key === HISTORY_KEY || event.key === null) historyStore.reload();};
          window.addEventListener('storage', reload);
          return () => window.removeEventListener('storage', reload);
        });
        const unreadStore = createUnreadStore(storage);
        ctx.effect(() => installUnread(ctx, unreadStore));
        function ManualUnreadDot({sessionId, useManualUnread}) {
          const unread = useManualUnread(state => state.enabled && state.ids.includes(sessionId));
          // The host owns placement and status priority; reuse its exact unread visual.
          return unread ? h('span', {'aria-label': '手动未读', title: 'DeepSearch 手动未读',
            style: {display: 'inline-flex'}}, h(StateDot, {state: 'done'})) : null;
        }
        ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
          name: 'sidebar.session.row.leading', id: 'deepsearch-manual-unread', order: 50,
          inject: () => ({hooks: {manualUnread: unreadStore}}),
        }, ManualUnreadDot));
        const shortcutStore = createShortcutTakeover(ctx.shortcuts, storage, () => setOpen(!opened));
        ctx.effect(() => () => shortcutStore.dispose());
        let opened = false, intent = null, releaseShell, cancelProjectReveal, previousFocus, preferredSessionId, selectionEpoch = 0, disposed = false;
        const listeners = new Set(), recoveries = new Map();
        const notify = () => { for (const listener of listeners) listener(); };
        const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
        const setOpen = value => {
          if (value && !opened) {cancelProjectReveal?.(); previousFocus = document.activeElement; preferredSessionId = currentSessionId(ctx.uiSession.adapter.current.getSnapshot(), ctx.sessions.list.getSnapshot());}
          if (!value) selectionEpoch++;
          opened = value; notify();
          if (!value && previousFocus?.isConnected) previousFocus.focus?.({preventScroll: true});
        };
        function clearIntent() {
          cancelProjectReveal?.(); cancelProjectReveal = undefined;
          const current = intent; intent = null;
          const release = releaseShell; releaseShell = undefined;
          current?.cancelDOM?.(); release?.(); window.CSS?.highlights?.delete('deepsearch-hit'); notify();
        }
        async function api(path, body, signal) {
          const deadline = AbortSignal.timeout(20000);
          const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
          try {
          const response = await fetch(new URL('api/deepsearch/' + path, document.baseURI), {
            method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: boundedSignal,
            headers: body ? {'Content-Type': 'application/json'} : undefined,
            body: body ? JSON.stringify(body) : undefined
          });
          const raw = await response.text();
          let value; try {value = JSON.parse(raw);} catch {throw new Error('搜索接口返回异常（HTTP ' + response.status + '），请重试');}
          if (!response.ok) throw new Error(value.error || '搜索服务返回 HTTP ' + response.status);
          return value;
          } catch (failure) {
            if (deadline.aborted || signal?.reason?.name === 'TimeoutError') throw new Error('搜索超时，请缩小工作区或重试');
            throw failure;
          }
        }
        function archiveState(sessionId) {
          const snapshot = ctx.workspaces?.list?.getSnapshot();
          if (snapshot?.phase !== 'ready' || snapshot.state !== 'idle' || !Array.isArray(snapshot.archivedSessionIds)) throw new Error('无法确认会话归档状态，请等待工作区加载后重试');
          return snapshot.archivedSessionIds.includes(sessionId);
        }
        function beginJump(item, query) {
          // Defense in depth: even imperative callers cannot reopen a known archived session.
          if (disposed) throw new Error('搜索已关闭');
          if (recoveries.has(item.sessionId)) throw new Error('恢复请求仍在进行，请等待完成后重试');
          if (ctx.workspaces?.list && archiveState(item.sessionId)) throw new Error('会话已归档，请先确认恢复并打开');
          clearIntent();
          ctx.uiWorkspace.openSession(item.sessionId); ctx.layout.selectPanel(null);
          if (!Number.isSafeInteger(item.seq)) {setOpen(false); return;}
          const current = intent = {...item, query, loaded: false, status: '正在加载命中消息的历史…'};
          const cancellation = new AbortController(), disposers = [];
          let reference, released = false, observedBinding;
          const isCurrent = () => intent === current && !cancellation.signal.aborted;
          releaseShell = () => {
            if (released) return; released = true; cancellation.abort();
            current.cancelDOM?.(); for (const dispose of disposers.splice(0)) dispose(); reference?.release();
          };
          const watch = () => {
            if (!isCurrent()) return;
            const binding = ctx.uiSession.adapter.current.getSnapshot();
            if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) {clearIntent(); return;}
            if (observedBinding && binding !== observedBinding) {clearIntent(); return;}
            if (binding.key === current.sessionId) observedBinding = binding;
            else if (binding.key && binding.key !== initialBinding.key) clearIntent();
          };
          const initialBinding = ctx.uiSession.adapter.current.getSnapshot();
          try {
            disposers.push(ctx.uiSession.adapter.current.subscribe(watch), ctx.layout.panelInfo.subscribe(watch));
            watch(); if (!isCurrent()) return;
            disposers.push(ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
              name: 'conversation.session.header.utilities', id: 'deepsearch-location', order: 20,
            }, JumpBody)));
            reference = ctx.sessions.retain(current.sessionId, {source: 'gateway'});
            loadExact(reference, current.seq, isCurrent, cancellation.signal).then(loaded => {
              if (!loaded || !isCurrent()) return;
              current.loaded = true; current.status = '历史已加载 · #' + current.seq + '；正在定位精确消息…'; notify();
            }).catch(failure => {
              if (!isCurrent()) return;
              current.status = '历史加载失败：' + failure.message; notify();
            });
            setOpen(false); notify();
          } catch (failure) {clearIntent(); throw failure;}
        }
        function JumpBody({sessionId, useChat, useSession}) {
          const current = React.useSyncExternalStore(subscribe, () => intent);
          const message = React.useSyncExternalStore(subscribe, () => intent?.status);
          const chat = useChat(snapshot => snapshot), session = useSession(snapshot => snapshot), root = React.useRef(null);
          const keys = selectedKeys(chat, current?.seq), keySignature = JSON.stringify(keys);
          React.useEffect(() => {
            if (!current || sessionId !== current.sessionId) return;
            return () => {if (intent === current) clearIntent();};
          }, [current, sessionId]);
          React.useEffect(() => {
            if (!current?.loaded || !root.current || sessionId !== current.sessionId) return;
            const frame = root.current.closest('header[data-window-drag]')?.closest('[data-phase]');
            const watchRoot = frame || root.current;
            let container, cancelled = false, finished = false, scrolled = false, observer, timer, markedRow;
            const alive = () => !cancelled && intent === current && ctx.uiSession.adapter.current.getSnapshot().key === sessionId && ctx.layout.panelInfo.getSnapshot().activePanelId === null;
            const status = value => {if (alive() && current.status !== value) {current.status = value; notify();}};
            const stopWatching = () => {clearTimeout(timer); observer?.disconnect(); watchRoot.removeEventListener('wheel', stop); watchRoot.removeEventListener('touchstart', stop);};
            const cleanup = () => {
              if (cancelled) return; cancelled = true; stopWatching();
              markedRow?.removeAttribute('data-deepsearch-hit'); window.CSS?.highlights?.delete('deepsearch-hit');
              if (current.cancelDOM === cleanup) current.cancelDOM = undefined;
            };
            const stop = () => {status('已停止自动定位；可继续手动阅读。'); finished = true; stopWatching();};
            function locate() {
              if (!alive() || finished) return;
              const candidate = [...(frame?.querySelectorAll('[data-conversation-content][data-conversation-session]') || [])].find(content => content.closest('[data-phase]') === frame && content.dataset.conversationSession === sessionId);
              container = candidate?.dataset.conversationSession === sessionId ? candidate : undefined;
              if (!container) return;
              const rows = [...container.querySelectorAll('[data-chat-flow] [data-chat-node-key]')].filter(row => row.closest('[data-conversation-content]') === container && keys.includes(row.getAttribute('data-chat-node-key')));
              const row = rows.find(row => row.getClientRects().length);
              if (!row) return;
              if (!scrolled) {row.scrollIntoView({block: 'center', behavior: 'instant'}); scrolled = true;}
              const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, {acceptNode(node) {
                return node.parentElement?.closest('script,style,button,input,textarea,[contenteditable="true"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
              }});
              let text = '', nodes = [], node;
              while ((node = walker.nextNode()) && text.length < 200000) {nodes.push({node, start: text.length}); text += node.textContent;}
              const escaped = current.query.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
              const match = escaped && new RegExp(escaped, 'iu').exec(text);
              if (match && window.CSS?.highlights && window.Highlight) {
                const index = match.index, end = index + match[0].length;
                const first = nodes.find(part => part.start + part.node.textContent.length > index), last = nodes.find(part => part.start + part.node.textContent.length >= end);
                if (first && last) {
                  const range = document.createRange(); range.setStart(first.node, index - first.start); range.setEnd(last.node, end - last.start);
                  if (range.getClientRects().length) {
                    markedRow = row; row.setAttribute('data-deepsearch-hit', '');
                    window.CSS.highlights.set('deepsearch-hit', new window.Highlight(range));
                    status('已定位并高亮命中消息 · #' + current.seq); finished = true; stopWatching(); return;
                  }
                }
              }
              status('已定位对应消息 · #' + current.seq + '；该内容暂不能高亮。');
            }
            current.cancelDOM?.(); current.cancelDOM = cleanup;
            watchRoot.addEventListener('wheel', stop, {passive: true}); watchRoot.addEventListener('touchstart', stop, {passive: true});
            observer = new MutationObserver(locate); observer.observe(watchRoot, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-conversation-session']});
            timer = setTimeout(() => {
              if (!alive() || finished) return;
              status(!container ? '历史已加载，但当前原生会话区域不可用；精确定位未完成。' : scrolled ? '已定位对应消息 · #' + current.seq + '；格式化内容可能无法逐字高亮。' : '历史已加载，但宿主未呈现对应消息；精确定位未完成。可返回搜索或手动查看。');
              finished = true; stopWatching();
            }, 8000);
            locate(); return cleanup;
          }, [current, current?.loaded, sessionId, keySignature, session?.openState]);
          if (!current || sessionId !== current.sessionId) return null;
          return h('div', {className: 'deepsearch-native-location', ref: root, style: {display: 'flex', alignItems: 'center', gap: 6, maxWidth: 'min(520px,50vw)', fontSize: 12}},
            h('style', null, '[data-deepsearch-hit]::highlight(deepsearch-hit),[data-deepsearch-hit] *::highlight(deepsearch-hit){background:#ffe69a;color:#302600}'),
            h('span', {role: 'status', style: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}, title: message}, message),
            h('button', {onClick: () => {clearIntent(); setOpen(true);}, style: {whiteSpace: 'nowrap'}}, '返回搜索'),
            h('button', {onClick: clearIntent, style: {whiteSpace: 'nowrap'}}, '退出定位'));
        }
        function Overlay() {
          const visible = React.useSyncExternalStore(subscribe, () => opened);
          const history = React.useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot);
          const [emptyView, setEmptyView] = React.useState(() => history.defaultHistory ? 'history' : 'recent');
          const unread = React.useSyncExternalStore(unreadStore.subscribe, unreadStore.getSnapshot);
          const shortcut = React.useSyncExternalStore(shortcutStore.subscribe, shortcutStore.getSnapshot);
          const liveSessions = React.useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot);
          const [query, setQuery] = React.useState(''), [tab, setTab] = React.useState('all');
          const [workspace, setWorkspace] = React.useState(''), [archived, setArchived] = React.useState(true);
          const [catalog, setCatalog] = React.useState({sessions: [], workspaces: []}), [catalogError, setCatalogError] = React.useState('');
          const [result, setResult] = React.useState({items: [], cursor: null, scanned: 0, totalSessions: 0, warnings: []});
          const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [index, setIndex] = React.useState(0), [retry, setRetry] = React.useState(0);
          const panel = React.useRef(null), input = React.useRef(null), list = React.useRef(null), control = React.useRef(null), generation = React.useRef(0), requestRef = React.useRef(null);
          const [composing, setComposing] = React.useState(false);
          const [confirmation, setConfirmation] = React.useState(null), [openError, setOpenError] = React.useState('');
          const selection = React.useRef(null);
          const cancelSelection = () => {selection.current?.cancel?.(); selection.current = null; setConfirmation(null); setOpenError('');};
          const [appearance, setAppearance] = React.useState(() => {try {return readAppearance(window.localStorage);} catch {return appearancePrefs(null);}});
          const [settings, setSettings] = React.useState(false), [appearanceError, setAppearanceError] = React.useState('');
          const updateAppearance = value => {
            const next = appearancePrefs(value); setAppearance(next);
            let saved = false; try {saved = saveAppearance(window.localStorage, next);} catch {}
            setAppearanceError(saved ? '' : '本次外观已应用，但浏览器禁止保存；重新打开后可能恢复默认。');
          };
          React.useEffect(() => {
            if (!visible) {setComposing(false); return;}
            setEmptyView(history.defaultHistory ? 'history' : 'recent');
            setQuery(''); setTab('all');
          }, [visible]);
          React.useEffect(() => {
            if (!visible || composing || !query.trim() || query.trim().length > 256) return;
            const timer = setTimeout(() => historyStore.add(query), 1000);
            return () => clearTimeout(timer);
          }, [query, visible, composing]);
          const request = {query: query.trim(), ...(workspace ? {workspaceId: workspace} : {}), ...(preferredSessionId ? {preferredSessionId} : {}), includeArchived: archived};
          requestRef.current = request;
          const key = JSON.stringify(request);
          const renderKey = JSON.stringify([key, tab, visible, composing, retry]);
          const activeRender = React.useRef(renderKey); activeRender.current = renderKey;
          React.useEffect(() => {cancelSelection(); return () => {selection.current?.cancel?.(); selection.current = null;};}, [renderKey]);
          React.useEffect(() => {
            if (!visible) return;
            input.current?.focus();
            const controller = new AbortController();
            setCatalogError('');
            api('catalog?includeArchived=true', null, controller.signal).then(setCatalog).catch(failure => {if (!controller.signal.aborted) setCatalogError(failure.message);});
            const outside = event => {if (panel.current && !panel.current.contains(event.target)) {event.preventDefault(); event.stopPropagation(); setOpen(false);}};
            document.addEventListener('pointerdown', outside, true);
            return () => {controller.abort(); document.removeEventListener('pointerdown', outside, true);};
          }, [visible, retry]);
          async function fetchPage(cursor, append, owner, requestValue, controller, renderOwner) {
            try {
              await scanPages({cursor, initialItems: append ? result.items : [], signal: controller.signal,
                isCurrent: () => generation.current === owner && activeRender.current === renderOwner,
                requestPage: (next, signal) => api('search', {...requestValue, ...(next ? {cursor: next} : {})}, signal),
                onPage: page => setResult({...page, renderOwner})});
            } catch (failure) {if (!controller.signal.aborted && generation.current === owner && activeRender.current === renderOwner) setError(failure.message);}
            finally {if (!controller.signal.aborted && generation.current === owner && activeRender.current === renderOwner) setBusy(false);}
          }
          React.useEffect(() => {
            control.current?.abort(); const controller = new AbortController(); control.current = controller;
            const owner = ++generation.current;
            setResult({items: [], cursor: null, scanned: 0, totalSessions: 0, warnings: []}); setIndex(0); setError(''); setBusy(false);
            if (!visible || !request.query || tab === 'projects' || composing) return () => controller.abort();
            setBusy(true);
            const timer = setTimeout(() => fetchPage(null, false, owner, requestRef.current, controller, renderKey), 220);
            return () => {clearTimeout(timer); controller.abort(); control.current?.abort();};
          }, [key, visible, tab, composing, retry]);
          const projects = (catalog.workspaces || []).filter(project => (!workspace || project.id === workspace) &&
            (!request.query || (project.title || '').toLocaleLowerCase().includes(request.query.toLocaleLowerCase()))).map(project => ({...project, kind: 'project'}));
          const recent = (catalog.sessions || []).filter(session => (!workspace || session.workspaceId === workspace) && (archived || !session.archived)).slice(0, 7).map(session => ({...session, kind: 'title', recent: true, updatedAt: liveSessions.byId?.[session.id]?.updatedAt ?? session.updatedAt, sessionId: session.id, workspaceTitle: (catalog.workspaces || []).find(project => project.id === session.workspaceId)?.title || '未分配项目'}));
          const visibleHits = result.renderOwner === renderKey ? result.items : [];
          const showingHistory = !request.query && tab !== 'projects' && emptyView === 'history';
          const items = showingHistory ? history.entries.map(entry => ({...entry, id: entry.query, kind: 'history', title: entry.query})) : tab === 'projects' ? projects : request.query ? (tab === 'all' ? projects.slice(0, 3).concat(visibleHits) : visibleHits) : recent;
          React.useEffect(() => {setIndex(old => Math.min(old, Math.max(0, items.length - 1)));}, [items.length]);
          function choose(item) {
            if (!item || !opened || disposed || activeRender.current !== renderKey) return;
            if (selection.current?.pending) return;
            cancelSelection();
            try {
              if (item.kind === 'history') {
                setQuery(item.query); setTab('all'); setIndex(0); input.current?.focus(); return;
              }
              if (item.kind === 'project') {
                if (typeof ctx.uiWorkspace.startSession !== 'function') throw new Error('当前宿主不支持在项目中新建会话，请升级后重试');
                clearIntent();
                // Native New Session preserves an existing blank's draft; never pass the search as a prompt.
                // startSession owns asynchronous reveal; selectPanel here aborts its pending navigation.
                cancelProjectReveal = revealProject(ctx, item.id, () => ctx.uiWorkspace.startSession(item.id));
                setOpen(false); return;
              }
              const isArchived = archiveState(item.sessionId);
              if (!isArchived && recoveries.has(item.sessionId)) throw new Error('恢复请求仍在进行，请等待完成后重试');
              if (isArchived) {
                const selected = {item, query: request.query, renderOwner: renderKey, epoch: selectionEpoch};
                selection.current = selected; setConfirmation(selected); return;
              }
              beginJump(item, request.query);
            } catch (failure) {setOpenError('打开失败：' + failure.message);}
          }
          async function restoreAndOpen() {
            const selected = selection.current;
            const current = () => selected && selection.current === selected && !disposed && opened && selectionEpoch === selected.epoch && activeRender.current === selected.renderOwner;
            if (!current() || selected.pending) return;
            selected.pending = true; setConfirmation({...selected}); setOpenError('');
            let timer;
            try {
              const stillArchived = archiveState(selected.item.sessionId);
              let recovery = recoveries.get(selected.item.sessionId);
              if (stillArchived || recovery) {
                if (!recovery) {
                  if (recoveries.size >= 4) throw new Error('已有多个恢复请求正在进行，请等待完成后重试');
                  if (typeof ctx.uiWorkspace.unarchiveSession !== 'function') throw new Error('当前宿主不支持恢复归档会话，请升级后重试');
                  recovery = Promise.resolve(ctx.uiWorkspace.unarchiveSession(selected.item.sessionId));
                  recoveries.set(selected.item.sessionId, recovery);
                  const finished = () => {if (recoveries.get(selected.item.sessionId) === recovery) recoveries.delete(selected.item.sessionId);};
                  recovery.then(finished, finished);
                }
                // A timeout/cancel stops this navigation, not the host's already submitted recovery.
                await new Promise((resolve, reject) => {
                  selected.cancel = () => {clearTimeout(timer); resolve();};
                  timer = setTimeout(() => reject(new Error('恢复超时；请求可能仍在完成，请刷新归档状态后重试')), 15000);
                  recovery.then(resolve, reject);
                });
              }
              if (!current()) return;
              if (archiveState(selected.item.sessionId)) throw new Error('恢复尚未确认，会话仍在归档中；请刷新归档状态后重试');
              beginJump(selected.item, selected.query);
            } catch (failure) {
              if (current()) {selected.pending = false; setConfirmation({...selected}); setOpenError('恢复失败：' + failure.message);}
            } finally {clearTimeout(timer); selected.cancel = undefined;}
          }
          if (!visible) return null;
          const more = () => {
            if (busy || !result.cursor || result.items.length >= MAX_RESULTS) return;
            cancelSelection();
            control.current?.abort(); const controller = new AbortController(); control.current = controller;
            const owner = ++generation.current; setBusy(true); setError('');
            fetchPage(result.cursor, true, owner, request, controller, renderKey);
          };
          const displayResult = result.renderOwner === renderKey ? result : {items: [], scanned: 0, totalSessions: 0, warnings: [], cursor: null};
          const status = searchStatus({busy: busy || (request.query && tab !== 'projects' && !composing && result.renderOwner !== renderKey && !error), error, result: displayResult, query: request.query, projects: tab === 'projects'});
          function onKey(event) {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || composing) return;
            if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); if (selection.current) cancelSelection(); else setOpen(false);}
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target === input.current) {
              event.preventDefault();
              const next = items.length ? (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length : 0;
              setIndex(next);
              // Hover changes highlight only; scrolling belongs exclusively to keyboard navigation.
              if (items.length) list.current?.querySelector('#deepsearch-result-' + next)?.scrollIntoView({block: 'nearest', behavior: 'instant'});
            }
            if (event.key === 'Enter' && event.target === input.current) {event.preventDefault(); if (!selection.current) choose(items[index]);}
            if (event.key === 'Tab') {
              const focusable = [...panel.current.querySelectorAll('button:not(:disabled),input,select,[tabindex="0"]')].filter(node => node.tabIndex >= 0 && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0);
              const first = focusable[0], last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
              else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
            }
          }
          return h('section', {className: 'deepsearch-panel', style: appearanceStyle(appearance), 'data-appearance': appearance.mode, role: 'dialog', 'aria-label': 'DeepSearch 全文搜索', 'aria-modal': false, ref: panel, onKeyDown: onKey},
            h('style', null, css + appearanceCss + archiveCss + extensionCss + historyCss),
            h('header', {className: 'deepsearch-search'}, h(Icon),
              h('input', {ref: input, value: query, maxLength: 256, placeholder: '搜索对话里的任何一句话…', 'aria-label': '搜索会话正文', role: 'combobox', 'aria-haspopup': showingHistory ? 'grid' : 'listbox', 'aria-expanded': true, 'aria-controls': 'deepsearch-results', 'aria-activedescendant': items[index] ? 'deepsearch-result-' + index : undefined, autoComplete: 'off', spellCheck: false, onChange: event => {cancelSelection(); setQuery(event.target.value);}, onCompositionStart: () => {cancelSelection(); setComposing(true);}, onCompositionEnd: () => setComposing(false)}),
              h('button', {className: 'deepsearch-escape', 'aria-expanded': settings, 'aria-controls': 'deepsearch-appearance', onClick: () => setSettings(value => !value)}, '设置'),
              h('button', {className: 'deepsearch-escape', onClick: () => setOpen(false), 'aria-label': '关闭 DeepSearch'}, 'esc')),
            settings && h('div', {className: 'deepsearch-appearance', id: 'deepsearch-appearance', role: 'group', 'aria-label': 'DeepSearch 设置'},
              h('div', {className: 'deepsearch-appearance-controls'}, h('label', null, '背景模式', h('select', {value: appearance.mode, onChange: e => updateAppearance({...appearance, mode:e.target.value})},
                ...[['glass','毛玻璃'],['theme','跟随 DSH'],['custom','自定义']].map(([value,label]) => h('option',{key:value,value},label)))),
              appearance.mode === 'custom' && h('label', null, '底色', h('input', {type:'color', value:appearance.color, onChange:e=>updateAppearance({...appearance,color:e.target.value})})),
              appearance.mode === 'custom' && h('label', null, '不透明度 ' + appearance.opacity + '%', h('input', {type:'range', min:55, max:100, value:appearance.opacity, onChange:e=>updateAppearance({...appearance,opacity:Number(e.target.value)})})),
              appearance.mode !== 'theme' && h('label', null, '模糊 ' + appearance.blur + 'px', h('input', {type:'range', min:0, max:32, value:appearance.blur, onChange:e=>updateAppearance({...appearance,blur:Number(e.target.value)})})),
              h('button', {type: 'button', className: 'deepsearch-reset', title: '恢复默认', 'aria-label': '恢复默认', onClick:()=>updateAppearance(null)}, h('svg', {width:16, height:16, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, 'aria-hidden':true}, h('path', {d:'M3 10a9 9 0 1 1 2.7 8.4M3 4v6h6'})))),
              appearanceError && h('p', {role:'status'}, appearanceError),
              h('div', {className: 'deepsearch-extension'},
                h('div', null, h('strong', {id: 'deepsearch-unread-label'}, '会话未读标记'), h('p', {id: 'deepsearch-unread-help'}, '扩展小功能 · 右键标记未读，再次打开自动已读。仅存本机；关闭保留标记。')),
                h('button', {type: 'button', role: 'switch', className: 'deepsearch-switch', 'aria-checked': unread.enabled, 'aria-labelledby': 'deepsearch-unread-label', 'aria-describedby': 'deepsearch-unread-help', onClick: () => unreadStore.setEnabled(!unread.enabled)}, h('span', {'aria-hidden': true}))),
              unreadStore.getError() && h('p', {role: 'status'}, unreadStore.getError()),
              h('div', {className: 'deepsearch-extension'},
                h('div', null, h('strong', {id: 'deepsearch-shortcut-label'}, '使用 ⌘K 打开 DeepSearch'), h('p', {id: 'deepsearch-shortcut-help', className:'deepsearch-shortcut-help', title:'仅 macOS 桌面端；写入 DSH 官方快捷键配置，关闭恢复开启前的绑定。卸载插件前请先关闭接管。'}, '替代原生搜索，关闭恢复原绑定；⌘⇧K 仍可用。'), h('span', {id:'deepsearch-shortcut-details', className:'deepsearch-sr-only'}, '仅 macOS 桌面端；写入 DSH 官方快捷键配置。卸载插件前请先关闭接管。')),
                h('button', {type: 'button', role: 'switch', className: 'deepsearch-switch', disabled: !shortcut.supported || shortcut.busy, 'aria-checked': shortcut.enabled, 'aria-labelledby': 'deepsearch-shortcut-label', 'aria-describedby': 'deepsearch-shortcut-help deepsearch-shortcut-details', onClick: () => shortcutStore.setEnabled(!shortcut.enabled)}, h('span', {'aria-hidden': true}))),
              shortcut.busy && h('p', {role: 'status'}, '正在保存快捷键配置…'),
              !shortcut.supported && h('p', {role: 'status'}, '当前宿主不支持 macOS 桌面快捷键配置，仍可使用 ⌘⇧K / Ctrl⇧K。'),
              shortcut.error && h('p', {role: 'alert'}, shortcut.error),
              shortcut.recovery && !shortcut.enabled && h('button', {disabled: shortcut.busy, onClick: () => shortcutStore.setEnabled(false)}, '恢复原快捷键绑定')),
            h('div', {className: 'deepsearch-toolbar'}, h('div', {className: 'deepsearch-tabs', role: 'tablist', 'aria-label': '结果类型'},
              ...[['all', '全部'], ['conversations', '对话'], ['projects', '项目']].map(([value, label]) => h('button', {key: value, role: 'tab', 'aria-selected': tab === value, onClick: () => {cancelSelection(); setTab(value);}}, label))),
              h('select', {'aria-label': '工作区范围', value: workspace, onChange: event => {cancelSelection(); setWorkspace(event.target.value);}}, h('option', {value: ''}, '所有工作区'), ...(catalog.workspaces || []).map(project => h('option', {key: project.id, value: project.id}, project.title)))),
            h('div', {className: 'deepsearch-caption'},
              !request.query && tab !== 'projects' ? h('div', {className:'deepsearch-tabs deepsearch-empty-tabs', role:'tablist', 'aria-label':'起始列表'},
                ...(history.defaultHistory ? [['history','搜索历史'],['recent','最近对话']] : [['recent','最近对话'],['history','搜索历史']]).map(([value,label]) => h('button', {key:value, type:'button', role:'tab', 'aria-selected':emptyView === value, onClick:() => {cancelSelection(); setEmptyView(value); setIndex(0);}}, label))) : h('span', null, tab === 'projects' ? '匹配项目' : '标题 · 你的输入 · 助手回复'),
              h('div', {className:'deepsearch-caption-options'},
                h('label', null, h('input', {type:'checkbox', checked:history.defaultHistory, onChange:event => historyStore.setDefault(event.target.checked)}), '默认历史'),
                tab !== 'projects' && h('label', null, h('input', {type: 'checkbox', checked: archived, onChange: event => {cancelSelection(); setArchived(event.target.checked);}}), '含归档'))),
            showingHistory && history.entries.length > 0 && h('div', {className:'deepsearch-history-tools'}, h('button', {type:'button', onClick:() => {historyStore.clear(); setIndex(0); input.current?.focus();}}, '清空搜索历史')),
            history.error && h('div', {className:'deepsearch-warning', role:'status'}, history.error),
            h('div', {className: 'deepsearch-results', ref: list, role: showingHistory ? 'grid' : 'listbox', id: 'deepsearch-results', 'aria-label': '搜索结果', 'aria-busy': busy},
              ...items.map((item, i) => item.kind === 'history' ? h('div', {key:item.id, id:'deepsearch-result-' + i, className:'deepsearch-result deepsearch-history-row', role:'row', 'aria-selected':index === i, onMouseEnter:() => setIndex(i)},
                h('div', {role:'gridcell', className:'deepsearch-history-main'}, h('button', {type:'button', className:'deepsearch-history-replay', onClick:() => choose(item), 'aria-label':'重新搜索：' + item.query}, h('span', {className:'deepsearch-result-icon'}, h(Icon)),
                  h('span', {className:'deepsearch-result-text'}, h('span', {className:'deepsearch-result-title'}, item.query), h('span', {className:'deepsearch-meta'}, formatMessageTime(item.time))), h('span', {className:'deepsearch-return', 'aria-hidden':true}, '↵'))),
                h('div', {role:'gridcell'}, h('button', {type:'button', className:'deepsearch-history-delete', title:'删除此条搜索历史', 'aria-label':'删除搜索历史：' + item.query, onClick:() => {historyStore.remove(item.query); input.current?.focus();}}, '×'))) : h('button', {key: item.id, id: 'deepsearch-result-' + i, className: 'deepsearch-result', tabIndex: -1, role: 'option', 'aria-selected': index === i, onMouseEnter: () => setIndex(i), onClick: () => choose(item)},
                h('span', {className: 'deepsearch-result-icon'}, h(Icon, {folder: item.kind === 'project'})),
                h('span', {className: 'deepsearch-result-text'}, h('span', {className: 'deepsearch-result-title'}, item.title || '未命名会话', item.archived === true && h('span', {className: 'deepsearch-archived'}, '已归档')),
                  item.snippet && h('span', {className: 'deepsearch-snippet'}, h(Mark, {text: item.snippet, range: item.range})),
                  h('span', {className: 'deepsearch-meta'}, item.kind === 'project' ? '工作区 · 点击或回车新建会话' :
                    item.recent ? [item.workspaceTitle, (typeof item.updatedAt === 'number' && item.updatedAt > 0 ? formatMessageTime(item.updatedAt) : null) || '时间未知'].join(' · ') : [item.role === 'user' ? '你' : item.role === 'assistant' ? '助手' : '会话标题', item.workspaceTitle, formatMessageTime(item.time)].filter(Boolean).join(' · '))), h('span', {className: 'deepsearch-return', 'aria-hidden': true}, '↵'))),
              !items.length && h('div', {className: 'deepsearch-empty', role: 'status'}, h(Icon), h('strong', null, showingHistory ? '暂无搜索历史' : status.empty),
                h('p', null, showingHistory ? '搜索关键词停顿 1 秒后自动记录，仅保存在本机。' : busy ? '逐批读取本地历史，不上传你的对话。' : request.query ? '支持连续中文片段，不需要输入整句话。' : '中文片段、英文关键词，都可以。'))),
            confirmation && h('div', {className: 'deepsearch-confirm', role: 'group', 'aria-label': '恢复归档会话', 'aria-busy': !!confirmation.pending},
              h('strong', null, '此会话已归档'),
              h('p', null, '恢复“' + (confirmation.item.title || '未命名会话') + '”后将在原生会话中打开；取消会保留当前结果。'),
              h('button', {onClick: restoreAndOpen, disabled: !!confirmation.pending}, confirmation.pending ? '正在恢复…' : '恢复并打开'),
              h('button', {onClick: cancelSelection}, '取消')),
            openError && h('div', {className: 'deepsearch-error', role: 'alert'}, openError),
            (error || catalogError) && h('div', {className: 'deepsearch-error', role: 'alert'}, error || '目录读取失败：' + catalogError, h('button', {onClick: () => error && displayResult.cursor ? more() : setRetry(value => value + 1)}, '重试')),
            displayResult.warnings?.length > 0 && h('div', {className: 'deepsearch-warning', role: 'status'}, '部分历史读取失败（' + displayResult.warnings.length + '）；当前结果可能不完整。'),
            tab !== 'projects' && displayResult.cursor && h('button', {className: 'deepsearch-more', onClick: more, disabled: busy || result.items.length >= MAX_RESULTS}, result.items.length >= MAX_RESULTS ? '已显示 200 条，请缩小搜索范围' : busy ? '正在继续扫描…' : '继续搜索剩余历史'),
            h('footer', {className: 'deepsearch-footer'}, h('span', null, h('strong', null, 'DeepSearch'), ' 0.1.17 / 本地全文'),
              h('span', {role: 'status'}, shortcut.enabled && status.footer === '⌘⇧K / Ctrl⇧K' ? '⌘K · ⌘⇧K / Ctrl⇧K' : status.footer),
              h('span', {className: 'deepsearch-key-hint'}, '↑↓ 选择  ↵ 打开')));
        }
        ctx.effect(() => {
          const onKey = event => {if (!isShortcut(event)) return; event.preventDefault(); event.stopPropagation(); setOpen(!opened);};
          window.addEventListener('keydown', onKey, true);
          return () => {disposed = true; window.removeEventListener('keydown', onKey, true); setOpen(false); clearIntent();};
        });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: 'deepsearch'}, Overlay));
      }
    };
  }
});
