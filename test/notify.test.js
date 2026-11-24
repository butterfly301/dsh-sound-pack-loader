import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { classifySessionEvent, createSoundEventTracker } from '../host/events.js';
import {
  MAX_SOUND_BYTES,
  createSoundStore,
  detectAudioFormat,
  sanitizeSoundFileName,
} from '../host/sound-store.js';

const CLIENT_CODE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function makeWav(bytes = 64) {
  const buf = Buffer.alloc(bytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(bytes - 8, 4);
  buf.write('WAVE', 8, 'ascii');
  return buf;
}

function makeId3Mp3(bytes = 32) {
  const buf = Buffer.alloc(bytes);
  buf.write('ID3', 0, 'ascii');
  return buf;
}

test('classifySessionEvent separates completed, failed, waiting, and ignores cancelled', () => {
  assert.equal(classifySessionEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } }), 'completed');
  assert.equal(classifySessionEvent({ type: 'turn/end', data: { reason: { kind: 'error' } } }), 'failed');
  assert.equal(classifySessionEvent({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }), 'failed');
  assert.equal(classifySessionEvent({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), null);
  assert.equal(classifySessionEvent({ type: 'turn/end', data: { reason: { kind: 'interrupted' } } }), null);
  assert.equal(classifySessionEvent({ type: 'tool/approval-requested' }), 'waiting');
});

test('createSoundEventTracker skips pre-existing history and captures new events across sessions', () => {
  const s1Events = [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }];
  const s2Events = [];
  const sessions = new Map([
    ['s1', { id: 's1', get seq() { return s1Events.length; }, eventAt: (i) => s1Events[i] }],
    ['s2', { id: 's2', get seq() { return s2Events.length; }, eventAt: (i) => s2Events[i] }],
  ]);

  const tracker = createSoundEventTracker();
  const initial = tracker.poll(sessions, null);
  assert.equal(initial.events.length, 0);

  s1Events.push({ type: 'turn/end', data: { reason: { kind: 'error' } } });
  s2Events.push({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
  s2Events.push({ type: 'turn/end', data: { reason: { kind: 'aborted' } } });

  const next = tracker.poll(sessions, initial.cursor);
  assert.deepEqual(next.events.map((e) => [e.sessionId, e.kind]), [
    ['s1', 'failed'],
    ['s2', 'completed'],
  ]);
});

test('detectAudioFormat and createSoundStore persist per-slot audio, reject invalid/oversized files, and clear independently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sound-pack-loader-'));
  try {
    assert.equal(detectAudioFormat(makeWav())?.ext, 'wav');
    assert.equal(detectAudioFormat(makeId3Mp3())?.ext, 'mp3');
    assert.equal(detectAudioFormat(Buffer.from('OggS\x00\x02\x00\x00\x00\x00\x00\x00'))?.ext, 'ogg');
    assert.equal(detectAudioFormat(Buffer.from('fLaC\x00\x00\x00\x22\x10\x00\x10\x00'))?.ext, 'flac');
    assert.equal(detectAudioFormat(Buffer.from('<svg></svg>')), null);
    assert.equal(sanitizeSoundFileName('C:\\fakepath\\bell\u0007.wav'), 'bell.wav');

    const store = createSoundStore({ dir });
    const initial = await store.inspectAll();
    assert.equal(initial.completed.hasCustom, false);

    const saved = await store.saveAudio('completed', makeWav(), 'ship-custom\\chime.wav');
    assert.equal(saved.hasCustom, true);
    assert.equal(saved.fileName, 'chime.wav');
    assert.equal(saved.mime, 'audio/wav');

    await store.saveAudio('failed', makeId3Mp3(), 'alarm.mp3');
    const afterSave = await store.inspectAll();
    assert.equal(afterSave.completed.fileName, 'chime.wav');
    assert.equal(afterSave.failed.fileName, 'alarm.mp3');
    assert.equal(afterSave.waiting.hasCustom, false);

    const readBack = await store.readAudio('completed');
    assert.equal(readBack?.mime, 'audio/wav');
    assert.equal(readBack?.fileName, 'chime.wav');

    await assert.rejects(() => store.saveAudio('completed', Buffer.from('<svg>bad</svg>'), 'bad.wav'), { status: 415 });
    await assert.rejects(() => store.saveAudio('completed', makeWav(MAX_SOUND_BYTES + 1), 'big.wav'), { status: 413 });

    const files = await readdir(dir);
    assert.equal(files.some((f) => f.endsWith('.tmp')), false);

    const cleared = await store.clearAudio('completed');
    assert.equal(cleared.hasCustom, false);
    const afterClear = await store.inspectAll();
    assert.equal(afterClear.completed.hasCustom, false);
    assert.equal(afterClear.failed.hasCustom, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('client handles triggerMode, single-channel interruption, 10s fade-out cap, custom slot override, and muted preview', async () => {
  let now = 10_000;
  let focused = false;
  let hidden = false;
  let pollFn = null;
  let pollQueue = [];
  let customSlots = {};
  const instances = [];
  const timeouts = [];
  const intervals = new Map();
  let nextTimerId = 1;
  const listeners = new Map();

  const windowMock = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(evt) {
      for (const fn of listeners.get(evt.type) || []) fn(evt);
    },
  };
  let loadedMod = null;
  windowMock.__ModuleLoader__ = { load(m) { loadedMod = m; } };

  class AudioMock {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      this.currentTime = 0;
      this.paused = false;
      this.playCount = 0;
      instances.push(this);
    }
    addEventListener() {}
    removeEventListener() {}
    play() {
      this.playCount += 1;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

  let formValue = {
    muted: false,
    volume: 0.7,
    triggerMode: 'background',
    events: { completed: true, failed: true, waiting: false },
    pack: {
      sounds: {
        completed: 'data:audio/wav;base64,BELL',
        failed: 'data:audio/wav;base64,HORN',
        waiting: 'data:audio/wav;base64,PIPE',
      },
    },
  };
  const formSubs = new Set();

  const sandbox = {
    window: windowMock,
    document: {
      get hidden() { return hidden; },
      hasFocus: () => focused,
    },
    Audio: AudioMock,
    Date: { now: () => now },
    fetch: async (url) => {
      if (String(url).startsWith('/sound-pack-loader/custom')) {
        return { ok: true, json: async () => ({ ok: true, slots: customSlots }) };
      }
      return {
        ok: true,
        json: async () => ({ ok: true, cursor: 1, events: pollQueue.splice(0) }),
      };
    },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timeouts.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const hit = timeouts.find((t) => t.id === id);
      if (hit) hit.cleared = true;
    },
    setInterval(fn, ms) {
      const id = nextTimerId++;
      if (!pollFn && ms === 1000) pollFn = fn;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    console,
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  let cleanup = null;
  loadedMod.factory().apply({
    configForms: {
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: formValue }),
        subscribe: (fn) => { formSubs.add(fn); return () => formSubs.delete(fn); },
      }),
    },
    effect(fn) { cleanup = fn(); return cleanup; },
  });

  const tick = async (events) => {
    pollQueue.push(...events);
    pollFn?.();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  // Background completed -> plays; second completed within 2s -> throttled
  await tick([{ kind: 'completed' }, { kind: 'completed' }]);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].src, 'data:audio/wav;base64,BELL');

  // Waiting is disabled -> silent
  now += 3000;
  await tick([{ kind: 'waiting' }]);
  assert.equal(instances.length, 1);

  // Foreground window in background triggerMode -> silent
  focused = true;
  await tick([{ kind: 'failed' }]);
  assert.equal(instances.length, 1);

  // Switch to always triggerMode -> plays even in foreground, interrupting previous audio
  formValue = { ...formValue, triggerMode: 'always' };
  for (const fn of formSubs) fn();
  await tick([{ kind: 'failed' }]);
  assert.equal(instances.length, 2);
  assert.equal(instances[0].paused, true);
  assert.equal(instances[1].src, 'data:audio/wav;base64,HORN');

  // Custom slot update routes event playback to custom URL and preview works when muted with zero volume fallback
  customSlots = { waiting: { hasCustom: true, fileName: 'my-ding.mp3', updatedAt: 42 } };
  windowMock.dispatchEvent({ type: 'dsh:sound-pack-loader:updated', detail: { slots: customSlots } });
  formValue = { ...formValue, muted: true, volume: 0 };
  for (const fn of formSubs) fn();
  windowMock.dispatchEvent({ type: 'dsh:sound-pack-loader:preview', detail: { kind: 'waiting' } });
  assert.equal(instances.length, 3);
  assert.equal(instances[1].paused, true);
  assert.equal(instances[2].src, '/sound-pack-loader/custom/waiting?v=42');
  assert.equal(instances[2].volume, 0.6);

  // 10s cap fade-out stops active audio smoothly
  const latestCap = timeouts.filter((t) => !t.cleared).at(-1);
  assert.ok(latestCap && latestCap.ms === 9800);
  latestCap.fn();
  const fadeInterval = [...intervals.values()].find((entry) => entry.ms === 40);
  assert.ok(fadeInterval);
  for (let i = 0; i < 5; i += 1) fadeInterval.fn();
  assert.equal(instances[2].paused, true);

  // Muted blocks automatic events even in always triggerMode
  now += 3000;
  await tick([{ kind: 'completed' }]);
  assert.equal(instances.length, 3);

  cleanup?.();
});

test('registers standalone settings.section when React and slots/remote.settings are available', () => {
  let loadedMod = null;
  const sandbox = {
    window: { __ModuleLoader__: { load(m) { loadedMod = m; } } },
    setInterval: () => 1,
    clearInterval: () => {},
    console,
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  const registered = [];
  const fakeReact = {
    createElement: (...args) => ({ args }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useCallback: (fn) => fn,
  };
  const fakeForm = {
    getSnapshot: () => ({ status: 'ready', value: { muted: false, volume: 0.8, triggerMode: 'background', events: {}, pack: false } }),
    subscribe: () => () => {},
  };
  let slotDisposed = 0;
  let scopeEffectCalls = 0;
  const scope = {
    locale: { getSnapshot: () => ({ active: 'zh' }) },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, render) => {
        registered.push({ meta, render });
        return () => { slotDisposed += 1; };
      },
    },
    remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
    effect: (fn) => { scopeEffectCalls += 1; return fn(); },
  };
  const ctx = {
    configForms: { get: () => fakeForm },
    locale: scope.locale,
    effect: (fn) => fn(),
    inject: (deps, fn) => {
      assert.equal(deps.includes('locale'), true);
      return fn(scope);
    },
  };

  const cleanup = loadedModuleCleanup();
  function loadedModuleCleanup() {
    return loadedMod.factory((id) => (id === 'react' ? fakeReact : null)).apply(ctx);
  }
  assert.equal(registered.length, 1);
  assert.equal(scopeEffectCalls, 1);
  assert.equal(registered[0].meta.id, 'dsh-sound-pack-loader');
  assert.equal(registered[0].meta.label(), '通知音效');
  cleanup?.();
  assert.equal(slotDisposed, 1);
});
