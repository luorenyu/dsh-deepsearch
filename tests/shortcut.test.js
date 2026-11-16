import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production controller, without loading React or mounting the plugin.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const start = source.indexOf('const SHORTCUT_KEY');
const end = source.indexOf('function joinItems', start);
assert.ok(start >= 0 && end > start, 'shortcut controller source boundaries exist');
const createShortcutTakeover = vm.runInNewContext(source.slice(start, end) + '\ncreateShortcutTakeover', {});
const KEY = 'dsh-deepsearch.shortcut-takeover.v1';
const PROFILE = 'desktop:macos';
const NATIVE = 'session.search';
const OWN = 'deepsearch.toggle';
const CMD_K = {code:'KeyK', modifiers:['meta']};
const CUSTOM = {code:'KeyF', modifiers:['meta', 'shift']};
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};

function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {getSnapshot:() => value, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    set(next) {value = next; for (const fn of [...listeners]) fn();}, listeners};
}

function harness({overrides = {}, savedJournal, storageFailure, status = 'ready', runtime = 'desktop', platform = 'macos',
  extra = [], editHook, descriptionIssue = null, registrationFailure = false, locks} = {}) {
  const events = [], edits = [], registrations = [], values = new Map();
  if (savedJournal !== undefined) values.set(KEY, typeof savedJournal === 'string' ? savedJournal : JSON.stringify(savedJournal));
  let revision = 1, registered = false, registrationDisposals = 0, toggles = 0;
  let current = clone(overrides);
  const config = observable({status, revision, document:{profiles:{[PROFILE]:clone(current)}}});
  const catalog = observable([]);
  const effective = id => Object.hasOwn(current, id) ? current[id] : id === NATIVE ? CMD_K : null;
  const sameBinding = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function publish() {
    config.set({status, revision, document:{profiles:{[PROFILE]:clone(current)}}});
    catalog.set([{id:NATIVE, binding:clone(effective(NATIVE)), conflicts:[]},
      ...(registered ? [{id:OWN, binding:clone(effective(OWN)), conflicts:[]}] : []), ...clone(extra)]);
  }
  const storage = {
    getItem(key) {events.push(['read', key]); if (storageFailure === 'read') throw new Error('storage unavailable'); return values.get(key) ?? null;},
    setItem(key, value) {events.push(['journal', key, JSON.parse(value)]); if (storageFailure === 'write') throw new Error('quota exceeded'); values.set(key, value);},
    removeItem(key) {events.push(['remove', key]); if (storageFailure === 'remove') throw new Error('remove denied'); values.delete(key);},
  };
  const service = {
    runtime, platform, config, catalog,
    register(command) {if (registrationFailure) throw new Error('register unavailable'); registrations.push(command); registered = true; publish(); return () => {registrationDisposals++; registered = false; publish();};},
    describeBinding(binding) {
      const validCode = code => /^Key[A-Z]$/.test(code);
      if (!validCode(binding.code) || (binding.secondCode !== undefined && (!validCode(binding.secondCode) || binding.secondCode === binding.code)))
        throw new Error('unsupported or duplicate physical code');
      return {issue:descriptionIssue, conflicts:catalog.getSnapshot().filter(row => sameBinding(row.binding, binding)).map(row => row.id)};
    },
    async edit(command, expectedRevision) {
      const call = {command:clone(command), revision:expectedRevision}; edits.push(call); events.push(['edit', call]);
      const injected = await editHook?.({index:edits.length, command:clone(command), expectedRevision, external});
      if (injected) return {status:injected, snapshot:config.getSnapshot()};
      if (expectedRevision !== revision) return {status:'stale', snapshot:config.getSnapshot()};
      if (command.type === 'reset') delete current[command.id]; else current[command.id] = clone(command.binding);
      revision++; publish(); return {status:'saved', snapshot:config.getSnapshot()};
    },
  };
  function external(changes) {current = {...current, ...clone(changes)}; revision++; publish();}
  publish();
  const factory = locks ? vm.runInNewContext(source.slice(start, end) + '\ncreateShortcutTakeover', {navigator:{locks}}) : createShortcutTakeover;
  const create = () => factory(service, storage, () => {toggles++;});
  const controller = create();
  return {controller, create, service, storage, values, events, edits, registrations, external,
    overrides:() => clone(current), journal:() => values.has(KEY) ? JSON.parse(values.get(KEY)) : null,
    disposals:() => registrationDisposals, toggles:() => toggles};
}

const expectedJournal = (native = {present:false}, own = {present:false}) => ({profile:PROFILE, native, own});
const commands = h => h.edits.map(call => call.command);

test('registers an unbound official command and starts without host writes', () => {
  const h = harness();
  assert.equal(h.registrations.length, 1);
  assert.equal(h.registrations[0].id, OWN);
  assert.deepEqual(clone(h.registrations[0].defaults), {});
  assert.deepEqual(clone(h.controller.getSnapshot()), {supported:true, enabled:false, busy:false, error:'', recovery:false});
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  h.registrations[0].resolve().run();
  assert.equal(h.toggles(), 1);
  h.controller.dispose();
  assert.equal(h.disposals(), 1);
  assert.equal(h.service.config.listeners.size, 0);
  assert.equal(h.service.catalog.listeners.size, 0);
  h.registrations[0].resolve().run();
  assert.equal(h.toggles(), 1, 'disposed command cannot invoke the overlay');
  assert.equal(h.edits.length, 0, 'uninstall must not edit configuration');
});

test('enable journals before writes, then disables native CmdK and assigns DeepSearch', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  assert.deepEqual(h.journal(), expectedJournal());
  assert.deepEqual(commands(h), [{type:'set', id:NATIVE, binding:null}, {type:'set', id:OWN, binding:CMD_K}]);
  assert.deepEqual(h.edits.map(call => call.revision), [1, 2]);
  assert.ok(h.events.findIndex(event => event[0] === 'journal') < h.events.findIndex(event => event[0] === 'edit'));
  assert.equal(h.controller.getSnapshot().enabled, true);
  assert.equal(h.controller.getSnapshot().recovery, true);
  assert.equal(h.controller.getSnapshot().error, '');
  h.controller.dispose();
});

test('disable restores absent overrides using reset, not hard-coded native CmdK', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  await h.controller.setEnabled(false);
  assert.deepEqual(commands(h).slice(2), [{type:'reset', id:OWN}, {type:'reset', id:NATIVE}]);
  assert.deepEqual(h.overrides(), {});
  assert.equal(h.journal(), null);
  assert.equal(h.controller.getSnapshot().enabled, false);
  assert.equal(h.controller.getSnapshot().recovery, false);
  assert.equal(h.controller.getSnapshot().error, '');
});

test('restores custom native and own overrides exactly, including explicit null', async () => {
  for (const own of [null, {code:'KeyD', modifiers:['alt']}]) {
    const original = {[NATIVE]:CUSTOM, [OWN]:own};
    const h = harness({overrides:original});
    await h.controller.setEnabled(true);
    assert.deepEqual(h.journal(), expectedJournal({present:true, value:CUSTOM}, {present:true, value:own}));
    await h.controller.setEnabled(false);
    assert.deepEqual(h.overrides(), original);
    assert.deepEqual(commands(h).slice(2), [{type:'set', id:OWN, binding:own}, {type:'set', id:NATIVE, binding:CUSTOM}]);
    assert.equal(h.journal(), null);
  }
});

test('refresh detects persisted takeover and restores the original custom binding on demand', async () => {
  const h = harness({overrides:{[NATIVE]:CUSTOM}});
  await h.controller.setEnabled(true);
  h.controller.dispose();
  const before = h.edits.length;
  const refreshed = h.create();
  assert.equal(h.edits.length, before, 'refresh performs no configuration writes');
  assert.equal(refreshed.getSnapshot().enabled, true);
  assert.equal(refreshed.getSnapshot().recovery, true);
  await refreshed.setEnabled(false);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.equal(h.journal(), null);
  refreshed.dispose();
});

test('startup with a partial journal does not repair config until explicit recovery', async () => {
  const h = harness({overrides:{[NATIVE]:null}, savedJournal:expectedJournal()});
  assert.equal(h.edits.length, 0);
  assert.equal(h.controller.getSnapshot().recovery, true);
  await h.controller.setEnabled(false);
  assert.deepEqual(commands(h), [{type:'reset', id:NATIVE}]);
  assert.deepEqual(h.overrides(), {});
  assert.equal(h.journal(), null);
});

test('storage write failure blocks all host edits', async () => {
  const h = harness({storageFailure:'write'});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.deepEqual(h.overrides(), {});
  assert.equal(h.journal(), null);
  assert.ok(h.controller.getSnapshot().error);
  assert.equal(h.controller.getSnapshot().busy, false);
});

test('not-ready configuration blocks the journal and all host edits', async () => {
  const h = harness({status:'loading'});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.ok(h.controller.getSnapshot().error);
});

test('third-party CmdK conflict blocks the journal and all host edits', async () => {
  const h = harness({extra:[{id:'another.search', binding:CMD_K}]});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.ok(h.controller.getSnapshot().error);
});

test('binding validation issue blocks all host edits', async () => {
  const h = harness({descriptionIssue:'reserved'});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.ok(h.controller.getSnapshot().error);
});

test('second edit write failure rolls native back and clears the resolved journal', async () => {
  const h = harness({overrides:{[NATIVE]:CUSTOM}, editHook:({index}) => index === 2 ? 'write-failed' : undefined});
  await h.controller.setEnabled(true);
  assert.deepEqual(commands(h), [{type:'set', id:NATIVE, binding:null}, {type:'set', id:OWN, binding:CMD_K}, {type:'set', id:NATIVE, binding:CUSTOM}]);
  assert.deepEqual(h.edits.map(call => call.revision), [1, 2, 2]);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.equal(h.journal(), null);
  assert.match(h.controller.getSnapshot().error, /write-failed/);
  assert.equal(h.controller.getSnapshot().enabled, false);
});

for (const failure of ['stale', 'conflict', 'write-failed']) {
  test('first edit ' + failure + ' is not automatically retried', async () => {
    const h = harness({editHook:() => failure});
    await h.controller.setEnabled(true);
    assert.equal(h.edits.length, 1);
    assert.deepEqual(h.overrides(), {});
    assert.match(h.controller.getSnapshot().error, new RegExp(failure));
    assert.equal(h.journal(), null);
  });
}

test('second edit stale after external native change never overwrites that change', async () => {
  const externalBinding = {code:'KeyJ', modifiers:['meta']};
  const h = harness({editHook:({index, external}) => {if (index === 2) {external({[NATIVE]:externalBinding}); return 'stale';}}});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 2, 'no retry or unsafe rollback over external edit');
  assert.deepEqual(h.overrides(), {[NATIVE]:externalBinding});
  assert.ok(h.journal(), 'journal remains for manual recovery');
  assert.match(h.controller.getSnapshot().error, /stale/);
});

test('second edit conflict after external own change never overwrites that change', async () => {
  const externalBinding = {code:'KeyJ', modifiers:['alt']};
  const h = harness({editHook:({index, external}) => {if (index === 2) {external({[OWN]:externalBinding}); return 'conflict';}}});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 2);
  assert.deepEqual(h.overrides(), {[NATIVE]:null, [OWN]:externalBinding});
  assert.ok(h.journal());
  assert.match(h.controller.getSnapshot().error, /conflict/);
});

test('external changes between successful native edit and own edit stop takeover', async () => {
  const h = harness();
  const unsubscribe = h.service.config.subscribe(() => {
    if (h.overrides()[NATIVE] === null && !Object.hasOwn(h.overrides(), OWN)) {
      unsubscribe(); h.external({[OWN]:CUSTOM});
    }
  });
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 1);
  assert.deepEqual(h.overrides(), {[NATIVE]:null, [OWN]:CUSTOM});
  assert.ok(h.journal());
  assert.ok(h.controller.getSnapshot().error);
});

for (const changed of [NATIVE, OWN]) {
  test('disable refuses to overwrite an externally modified ' + changed, async () => {
    const h = harness();
    await h.controller.setEnabled(true);
    h.external({[changed]:CUSTOM});
    const before = h.edits.length;
    await h.controller.setEnabled(false);
    assert.equal(h.edits.length, before);
    assert.deepEqual(h.overrides()[changed], CUSTOM);
    assert.ok(h.journal());
    assert.ok(h.controller.getSnapshot().error);
  });
}

test('busy serial gate ignores overlapping enable and disable calls', async () => {
  const gate = deferred();
  const h = harness({editHook:({index}) => index === 1 ? gate.promise : undefined});
  const first = h.controller.setEnabled(true);
  assert.equal(h.controller.getSnapshot().busy, true);
  await h.controller.setEnabled(true);
  await h.controller.setEnabled(false);
  assert.equal(h.edits.length, 1);
  gate.resolve();
  await first;
  assert.equal(h.edits.length, 2);
  assert.equal(h.controller.getSnapshot().busy, false);
  assert.equal(h.controller.getSnapshot().enabled, true);
});

test('subscriptions publish transition/external updates and unsubscribe cleanly', async () => {
  const h = harness();
  const seen = [];
  const off = h.controller.subscribe(() => seen.push(clone(h.controller.getSnapshot())));
  await h.controller.setEnabled(true);
  assert.ok(seen.some(snapshot => snapshot.busy));
  assert.equal(seen.at(-1).enabled, true);
  h.external({[OWN]:CUSTOM});
  assert.equal(seen.at(-1).enabled, false);
  off(); const count = seen.length;
  h.external({[OWN]:CMD_K});
  assert.equal(seen.length, count);
  h.controller.dispose();
  assert.equal(h.service.config.listeners.size, 0);
  assert.equal(h.service.catalog.listeners.size, 0);
});

test('dispose after takeover preserves recovery and never edits host configuration', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  const before = h.edits.length;
  h.controller.dispose(); h.controller.dispose();
  await h.controller.setEnabled(false);
  assert.equal(h.edits.length, before);
  assert.deepEqual(h.overrides(), {[NATIVE]:null, [OWN]:CMD_K});
  assert.ok(h.journal());
  assert.equal(h.disposals(), 1);
});

for (const target of [{runtime:'web'}, {platform:'windows'}, {platform:'linux'}]) {
  test('unsupported ' + JSON.stringify(target) + ' performs no registration or writes', async () => {
    const h = harness(target);
    await h.controller.setEnabled(true); await h.controller.setEnabled(false);
    assert.equal(h.controller.getSnapshot().supported, false);
    assert.equal(h.edits.length, 0);
    assert.equal(h.registrations.length, 0);
    assert.equal(h.values.size, 0);
    h.controller.dispose();
  });
}

test('first stale edit with an external override preserves external config and journal', async () => {
  const h = harness({editHook:({external}) => {external({[NATIVE]:CUSTOM}); return 'stale';}});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 1);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.ok(h.journal());
  assert.match(h.controller.getSnapshot().error, /stale/);
});

test('external native change during own restore stops before native edit', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  const off = h.service.config.subscribe(() => {
    if (!Object.hasOwn(h.overrides(), OWN)) {off(); h.external({[NATIVE]:CUSTOM});}
  });
  await h.controller.setEnabled(false);
  assert.deepEqual(commands(h).slice(2), [{type:'reset', id:OWN}]);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.ok(h.journal());
  assert.ok(h.controller.getSnapshot().error);
});

test('external own change during native restore retains journal instead of claiming success', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  const off = h.service.config.subscribe(() => {
    if (!Object.hasOwn(h.overrides(), NATIVE)) {off(); h.external({[OWN]:CUSTOM});}
  });
  await h.controller.setEnabled(false);
  assert.deepEqual(h.overrides(), {[OWN]:CUSTOM});
  assert.ok(h.journal());
  assert.equal(h.controller.getSnapshot().recovery, true);
  assert.ok(h.controller.getSnapshot().error);
});

test('rollback write failure retains journal for later explicit recovery', async () => {
  const h = harness({editHook:({index}) => index >= 2 ? 'write-failed' : undefined});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 3);
  assert.deepEqual(h.overrides(), {[NATIVE]:null});
  assert.ok(h.journal());
  assert.equal(h.controller.getSnapshot().recovery, true);
  assert.match(h.controller.getSnapshot().error, /write-failed/);
});

for (const savedJournal of ['{broken', 'null', {profile:'desktop:windows', native:{present:false}, own:{present:false}},
  expectedJournal({present:true}, {present:false}), expectedJournal({present:true, value:{code:'KeyK', modifiers:['invalid']}}, {present:false})]) {
  test('invalid persisted journal blocks edits: ' + JSON.stringify(savedJournal), async () => {
    const h = harness({savedJournal});
    const original = h.values.get(KEY);
    assert.ok(h.controller.getSnapshot().error);
    await h.controller.setEnabled(true);
    assert.equal(h.edits.length, 0);
    assert.equal(h.values.get(KEY), original);
    assert.ok(h.controller.getSnapshot().error);
  });
}

test('unreadable storage blocks enable without host edits', async () => {
  const h = harness({storageFailure:'read'});
  assert.ok(h.controller.getSnapshot().error);
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.ok(h.controller.getSnapshot().error);
});

test('failed journal removal keeps recoverable backup after successful restore', async () => {
  const h = harness({storageFailure:'remove'});
  await h.controller.setEnabled(true);
  await h.controller.setEnabled(false);
  assert.deepEqual(h.overrides(), {});
  assert.ok(h.journal());
  assert.equal(h.controller.getSnapshot().recovery, true);
  assert.ok(h.controller.getSnapshot().error);
});

test('registration failure disables takeover and does not write config or storage', async () => {
  const h = harness({registrationFailure:true});
  assert.equal(h.controller.getSnapshot().supported, false);
  assert.ok(h.controller.getSnapshot().error);
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.equal(h.service.config.listeners.size, 0);
  assert.equal(h.service.catalog.listeners.size, 0);
  h.controller.dispose();
});

test('two controllers sharing storage cannot overwrite a newer takeover journal', async () => {
  const h = harness({overrides:{[NATIVE]:CUSTOM}});
  const second = h.create();
  await h.controller.setEnabled(true);
  const originalJournal = h.values.get(KEY), before = h.edits.length;
  await second.setEnabled(true);
  assert.equal(h.edits.length, before, 'second controller must not take over an already journaled profile');
  assert.equal(h.values.get(KEY), originalJournal, 'preserve original custom binding backup');
  assert.deepEqual(h.journal(), expectedJournal({present:true, value:CUSTOM}));
  assert.ok(second.getSnapshot().error);
  await second.setEnabled(false);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM}, 'second controller rereads the shared journal for restore');
  assert.equal(h.journal(), null);
  second.dispose(); h.controller.dispose();
});

test('a controller with cached journal rereads storage before restoring', async () => {
  const h = harness();
  await h.controller.setEnabled(true);
  const second = h.create();
  await second.setEnabled(false);
  const before = h.edits.length;
  h.external({[NATIVE]:CUSTOM});
  await h.controller.setEnabled(false);
  assert.equal(h.edits.length, before);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.equal(h.journal(), null);
  assert.equal(h.controller.getSnapshot().recovery, false);
  assert.ok(h.controller.getSnapshot().error);
  second.dispose(); h.controller.dispose();
});

for (const binding of [
  {code:'Bogus', modifiers:['meta']},
  {code:'KeyK', secondCode:'Bogus', modifiers:['meta']},
  {code:'KeyK', secondCode:'KeyK', modifiers:['meta']},
  {code:'KeyK', secondCode:42, modifiers:['meta']},
  {code:'KeyK', modifiers:['meta'], unexpected:true},
]) {
  for (const command of [NATIVE, OWN]) {
    test('invalid ' + command + ' backup causes zero restore writes: ' + JSON.stringify(binding), async () => {
      const backup = expectedJournal();
      backup[command === NATIVE ? 'native' : 'own'] = {present:true, value:binding};
      const h = harness({overrides:{[NATIVE]:null, [OWN]:CMD_K}, savedJournal:backup});
      const original = h.values.get(KEY);
      await h.controller.setEnabled(false);
      assert.equal(h.edits.length, 0, 'validate every saved binding before unbinding either command');
      assert.deepEqual(h.overrides(), {[NATIVE]:null, [OWN]:CMD_K});
      assert.equal(h.values.get(KEY), original);
      assert.ok(h.controller.getSnapshot().error);
    });
  }
}

test('Web Locks serializes separate controllers before rereading the shared journal', async () => {
  const calls = [], entered = deferred(), release = deferred();
  let queue = Promise.resolve(), active = 0, maximumActive = 0;
  const locks = {request(name, run) {
    calls.push(name);
    const result = queue.then(async () => {active++; maximumActive = Math.max(maximumActive, active); try {return await run();} finally {active--;}});
    queue = result.catch(() => {});
    return result;
  }};
  const h = harness({overrides:{[NATIVE]:CUSTOM}, locks, editHook:async ({index}) => {
    if (index === 1) {entered.resolve(); await release.promise;}
  }});
  const second = h.create();
  const firstEnable = h.controller.setEnabled(true);
  await entered.promise;
  const secondEnable = second.setEnabled(true);
  assert.deepEqual(calls, [KEY, KEY]);
  assert.equal(h.edits.length, 1, 'second controller waits before journal or config edits');
  release.resolve();
  await Promise.all([firstEnable, secondEnable]);
  assert.equal(maximumActive, 1);
  assert.equal(h.edits.length, 2, 'second controller sees the first journal instead of replacing it');
  assert.deepEqual(h.journal(), expectedJournal({present:true, value:CUSTOM}));
  assert.ok(second.getSnapshot().error);
  await second.setEnabled(false);
  assert.deepEqual(h.overrides(), {[NATIVE]:CUSTOM});
  assert.equal(h.journal(), null);
});

test('recovery never removes a journal replaced while host restoration is finishing', async () => {
  const replacement = expectedJournal({present:true, value:CUSTOM});
  const h = harness({editHook:({index}) => {if (index === 4) h.storage.setItem(KEY, JSON.stringify(replacement));}});
  await h.controller.setEnabled(true);
  await h.controller.setEnabled(false);
  assert.deepEqual(h.overrides(), {});
  assert.deepEqual(h.journal(), replacement, "do not delete another window's recovery record");
  assert.equal(h.controller.getSnapshot().recovery, true);
  assert.ok(h.controller.getSnapshot().error);
});

test('Web Lock failure clears busy without writing config or backup', async () => {
  const h = harness({locks:{request:async () => {throw new Error('lock unavailable');}}});
  await h.controller.setEnabled(true);
  assert.equal(h.edits.length, 0);
  assert.equal(h.values.size, 0);
  assert.equal(h.controller.getSnapshot().busy, false);
  assert.ok(h.controller.getSnapshot().error);
});

test('missing official service degrades safely without storage writes', async () => {
  const values = new Map();
  const controller = createShortcutTakeover(undefined, {getItem:() => null, setItem:(...args) => values.set(...args)}, () => {});
  assert.equal(controller.getSnapshot().supported, false);
  await controller.setEnabled(true); await controller.setEnabled(false);
  assert.equal(values.size, 0);
  controller.dispose();
});
