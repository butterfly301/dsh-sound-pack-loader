window.__ModuleLoader__.load({
  id: 'dsh-sound-pack-loader',
  factory(require) {
    const React = typeof require === 'function'
      ? (() => { try { return require('react'); } catch { return null; } })()
      : null;

    const NS = 'dsh-sound-pack-loader';
    const POLL_ROUTE = '/sound-pack-loader/poll';
    const CUSTOM_ROUTE = '/sound-pack-loader/custom';
    const PREVIEW_EVENT = 'dsh:sound-pack-loader:preview';
    const UPDATED_EVENT = 'dsh:sound-pack-loader:updated';
    const POLL_MS = 1000;
    const THROTTLE_MS = 2000;
    const MAX_PLAYBACK_MS = 10_000;
    const FADE_OUT_MS = 200;
    const FADE_STEPS = 5;
    const FALLBACK_PREVIEW_VOLUME = 0.6;
    const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
    const SOUND_ACCEPT = '.wav,.mp3,.ogg,.m4a,.flac,.webm,audio/wav,audio/mpeg,audio/ogg,audio/mp4,audio/flac,audio/webm';

    const UI_COPY = {
      zh: {
        nav: '通知音效',
        title: '通知音效',
        hint: '为任务完成、异常失败与等待确认配置提醒音效；用户主动取消任务保持静音。上传限制为 2 MB，最长播放 10 秒。',
        muted: '总静音',
        triggerMode: '触发时机',
        triggerBg: '仅后台或失焦',
        triggerAlways: '始终提醒',
        volume: '总音量',
        completed: '任务完成',
        failed: '异常失败',
        waiting: '等待用户确认',
        defaultSlot: '内置默认音效',
        noSlot: '未设置自定义音频',
        upload: '上传音频',
        reset: '恢复默认',
        preview: '试听',
        uploaded: '已更新并试听',
        resetDone: '已恢复默认',
        tooLarge: '音频文件超出大小限制。',
        decodeFailed: '当前环境无法解码该音频文件。',
        unsupported: '仅支持 WAV、MP3、OGG、M4A、FLAC、WebM 音频文件。',
        uploadFailed: '上传失败，请稍后重试。',
        unavailable: '宿主音频接口不可用。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        loading: '加载中…',
      },
      en: {
        nav: 'Notify sound',
        title: 'Notification sounds',
        hint: 'Configure audio alerts for completed, failed, and waiting-for-confirmation turns. Manual cancellations stay silent. Max 2 MB per file, capped at 10s.',
        muted: 'Mute all',
        triggerMode: 'Trigger timing',
        triggerBg: 'Background only',
        triggerAlways: 'Always notify',
        volume: 'Master volume',
        completed: 'Task completed',
        failed: 'Task failed',
        waiting: 'Waiting for confirmation',
        defaultSlot: 'Pack default sound',
        noSlot: 'No custom audio set',
        upload: 'Upload audio',
        reset: 'Restore default',
        preview: 'Preview',
        uploaded: 'Updated and previewed',
        resetDone: 'Restored default',
        tooLarge: 'Audio file exceeds the size limit.',
        decodeFailed: 'Cannot decode this audio file in the desktop player.',
        unsupported: 'Only WAV, MP3, OGG, M4A, FLAC, and WebM files are supported.',
        uploadFailed: 'Audio upload failed; please try again.',
        unavailable: 'Host audio storage is unavailable.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        loading: 'Loading…',
      },
    };

    const SETTINGS_CSS = `
.ns-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.ns-card {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
}
.ns-card__title { font-weight: 600; margin-bottom: 2px; }
.ns-card__hint { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; margin-bottom: 10px; }
.ns-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: .5px solid var(--dsw-alias-border-l2);
  flex-wrap: wrap;
}
.ns-row:first-of-type { border-top: none; }
.ns-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ns-sub { color: var(--dsw-alias-label-tertiary); font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ns-field { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; border-top: .5px solid var(--dsw-alias-border-l2); }
.ns-field__label { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.ns-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ns-switch { position: relative; display: inline-flex; align-items: center; min-height: 30px; cursor: pointer; }
.ns-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.ns-switch__track {
  position: relative; width: 34px; height: 19px; box-sizing: border-box; border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); transition: background .15s;
}
.ns-switch__thumb {
  position: absolute; top: 50%; left: 2px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--dsw-alias-label-tertiary); transform: translateY(-50%); transition: left .15s, background .15s;
}
.ns-switch input:checked + .ns-switch__track { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.ns-switch input:checked + .ns-switch__track .ns-switch__thumb { left: 17px; background: var(--dsw-alias-bg-layer-1); }
.ns-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); overflow: hidden; }
.ns-seg button { padding: 4px 12px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.ns-seg button + button { border-left: .5px solid var(--dsw-alias-border-l2); }
.ns-seg button[data-on="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-button-primary-hover); font-weight: 600;
}
.ns-btn {
  padding: 6px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.ns-btn:disabled { opacity: .5; cursor: not-allowed; }
.ns-save {
  align-self: flex-start; padding: 7px 18px; border: none; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-button-primary-text, #fff); font: inherit; font-weight: 600; cursor: pointer;
}
.ns-save:disabled { opacity: .6; cursor: not-allowed; }
.ns-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; }
`;

    function isWindowInBackground() {
      if (typeof document === 'undefined') return true;
      if (document.hidden) return true;
      if (typeof document.hasFocus === 'function') return !document.hasFocus();
      return false;
    }

    function hasAnyCustomSlot(slots) {
      if (!slots || typeof slots !== 'object') return false;
      return ['completed', 'failed', 'waiting'].some((k) => Boolean(slots[k]?.hasCustom));
    }

    function normalizeConfig(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const pack = raw.pack && typeof raw.pack === 'object' ? raw.pack : null;
      const sounds = pack?.sounds && typeof pack.sounds === 'object' ? pack.sounds : {};
      const events = raw.events && typeof raw.events === 'object' ? raw.events : {};
      const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume)
        ? Math.min(1, Math.max(0, raw.volume))
        : 0.8;
      const triggerMode = raw.triggerMode === 'always' ? 'always' : 'background';
      return {
        hasPack: Boolean(pack),
        muted: Boolean(raw.muted),
        volume,
        triggerMode,
        events: {
          completed: events.completed !== false,
          failed: events.failed !== false,
          waiting: events.waiting === true,
        },
        sounds: {
          completed: typeof sounds.completed === 'string' ? sounds.completed : '',
          failed: typeof sounds.failed === 'string' ? sounds.failed : '',
          waiting: typeof sounds.waiting === 'string' ? sounds.waiting : '',
        },
      };
    }

    async function probePlayableAudio(file, maxBytes) {
      const buf = await file.arrayBuffer();
      if (!buf || buf.byteLength === 0 || buf.byteLength > maxBytes) {
        return { ok: false, reason: 'size', buf: null };
      }
      if (typeof Audio !== 'function' || typeof URL?.createObjectURL !== 'function') {
        return { ok: true, buf };
      }
      const blob = new Blob([buf], { type: file.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const playable = await new Promise((resolve) => {
        let settled = false;
        const audio = new Audio();
        const done = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          audio.removeEventListener('loadedmetadata', onOk);
          audio.removeEventListener('canplay', onOk);
          audio.removeEventListener('error', onErr);
          try { audio.removeAttribute('src'); audio.load(); } catch {}
          resolve(result);
        };
        const onOk = () => done(true);
        const onErr = () => done(false);
        const timer = setTimeout(() => done(false), 4000);
        audio.preload = 'metadata';
        audio.addEventListener('loadedmetadata', onOk);
        audio.addEventListener('canplay', onOk);
        audio.addEventListener('error', onErr);
        audio.src = url;
        try { audio.load(); } catch {}
      });
      try { URL.revokeObjectURL(url); } catch {}
      return { ok: playable, reason: playable ? '' : 'decode', buf: playable ? buf : null };
    }

    function createSingleChannelPlayer() {
      let active = null;

      const clearTimers = (entry) => {
        if (!entry) return;
        if (entry.capTimer !== null) {
          clearTimeout(entry.capTimer);
          entry.capTimer = null;
        }
        if (entry.fadeTimer !== null) {
          clearInterval(entry.fadeTimer);
          entry.fadeTimer = null;
        }
      };

      const stopEntry = (entry) => {
        if (!entry) return;
        clearTimers(entry);
        try {
          if (typeof entry.audio.removeEventListener === 'function') {
            entry.audio.removeEventListener('ended', entry.onDone);
            entry.audio.removeEventListener('error', entry.onDone);
          }
        } catch {}
        try {
          if (typeof entry.audio.pause === 'function') entry.audio.pause();
          if ('currentTime' in entry.audio) entry.audio.currentTime = 0;
        } catch {}
        if (active === entry) active = null;
      };

      const stop = () => {
        if (active) stopEntry(active);
      };

      const play = (src, volume) => {
        if (!src || typeof Audio !== 'function') return;
        stop();
        const clampedVol = Math.min(1, Math.max(0, Number(volume) || 0));
        if (clampedVol <= 0) return;

        let audio;
        try {
          audio = new Audio(src);
          audio.volume = clampedVol;
        } catch {
          return;
        }

        const entry = {
          audio,
          capTimer: null,
          fadeTimer: null,
          onDone: null,
        };
        entry.onDone = () => {
          if (active === entry) stopEntry(entry);
        };
        active = entry;

        try {
          if (typeof audio.addEventListener === 'function') {
            audio.addEventListener('ended', entry.onDone);
            audio.addEventListener('error', entry.onDone);
          }
        } catch {}

        const fadeStartMs = Math.max(0, MAX_PLAYBACK_MS - FADE_OUT_MS);
        entry.capTimer = setTimeout(() => {
          if (active !== entry) return;
          entry.capTimer = null;
          let step = 0;
          const stepMs = Math.max(10, Math.floor(FADE_OUT_MS / FADE_STEPS));
          entry.fadeTimer = setInterval(() => {
            if (active !== entry) {
              clearTimers(entry);
              return;
            }
            step += 1;
            const ratio = Math.max(0, 1 - step / FADE_STEPS);
            try {
              audio.volume = Number((clampedVol * ratio).toFixed(4));
            } catch {}
            if (step >= FADE_STEPS) {
              stopEntry(entry);
            }
          }, stepMs);
        }, fadeStartMs);

        try {
          const p = audio.play();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              if (active === entry) stopEntry(entry);
            });
          }
        } catch {
          stopEntry(entry);
        }
      };

      return { play, stop };
    }

    function createSettingsPanelComponent(R) {
      const { useState, useEffect, useRef, useCallback } = R;
      const h = R.createElement;

      function copyOf(locale) {
        const active = locale?.getSnapshot?.()?.active || '';
        const primary = String(active).split(/[-_]/)[0].toLowerCase();
        return primary === 'zh' ? UI_COPY.zh : UI_COPY.en;
      }

      return function NotifySoundSettingsPanel({ form, locale, saveOps }) {
        const [snap, setSnap] = useState(() => form.getSnapshot());
        const [draft, setDraft] = useState(null);
        const [dirty, setDirty] = useState(false);
        const [saving, setSaving] = useState(false);
        const [savedFlag, setSavedFlag] = useState(false);
        const [error, setError] = useState('');
        const [custom, setCustom] = useState({ available: true, maxBytes: DEFAULT_MAX_BYTES, busyKind: null, messageKind: '', message: '', slots: {} });
        const [, setLangTick] = useState(0);
        const dirtyRef = useRef(false);
        const inputRefs = useRef({});
        const copy = copyOf(locale);

        const refreshCustom = useCallback(() => {
          if (typeof fetch !== 'function') return;
          fetch(CUSTOM_ROUTE, { cache: 'no-store' })
            .then((res) => (res && res.ok ? res.json() : null))
            .then((payload) => {
              if (payload && payload.ok) {
                setCustom((prev) => ({
                  ...prev,
                  available: true,
                  maxBytes: typeof payload.maxBytes === 'number' && payload.maxBytes > 0 ? payload.maxBytes : prev.maxBytes,
                  slots: payload.slots && typeof payload.slots === 'object' ? payload.slots : {},
                }));
              } else {
                setCustom((prev) => ({ ...prev, available: false }));
              }
            })
            .catch(() => setCustom((prev) => ({ ...prev, available: false })));
        }, []);

        useEffect(() => {
          refreshCustom();
          const onUpdated = (evt) => {
            const slots = evt?.detail?.slots;
            if (slots && typeof slots === 'object') {
              setCustom((prev) => ({ ...prev, available: true, slots }));
            } else {
              refreshCustom();
            }
          };
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener(UPDATED_EVENT, onUpdated);
          }
          const unsubForm = form.subscribe(() => {
            const next = form.getSnapshot();
            setSnap(next);
            if (!dirtyRef.current && next.status === 'ready') {
              setDraft(null);
            }
          });
          const unsubLocale = typeof locale?.subscribe === 'function'
            ? locale.subscribe(() => setLangTick((v) => v + 1))
            : undefined;
          return () => {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener(UPDATED_EVENT, onUpdated);
            }
            try { unsubForm?.(); } catch {}
            try { unsubLocale?.(); } catch {}
          };
        }, [form, locale, refreshCustom]);

        if (!snap || snap.status === 'loading') {
          return h('div', { className: 'ns-panel' }, h('div', { className: 'ns-sub' }, copy.loading));
        }

        const current = draft || (snap.value && typeof snap.value === 'object' ? snap.value : {});
        const events = current.events && typeof current.events === 'object' ? current.events : {};
        const volPct = Math.round((typeof current.volume === 'number' ? current.volume : 0.8) * 100);
        const triggerMode = current.triggerMode === 'always' ? 'always' : 'background';
        const hasPack = Boolean(current.pack && typeof current.pack === 'object');

        const patchDraft = (patch) => {
          dirtyRef.current = true;
          setDirty(true);
          setSavedFlag(false);
          setDraft((prev) => {
            const base = prev || (snap.value && typeof snap.value === 'object' ? snap.value : {});
            return { ...base, ...patch };
          });
        };

        const emitUpdated = (slots) => {
          try {
            window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { slots, version: Date.now() } }));
          } catch {}
        };

        const onPreview = (kind, overrideSlots) => {
          try {
            const volume = typeof current.volume === 'number' ? current.volume : 0.8;
            window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, {
              detail: { kind, volume, slots: overrideSlots || custom.slots },
            }));
          } catch {}
        };

        const onUpload = async (kind, file) => {
          if (!kind || !file) return;
          if (file.size <= 0 || file.size > custom.maxBytes) {
            setCustom((prev) => ({ ...prev, messageKind: kind, message: copy.tooLarge }));
            return;
          }
          setCustom((prev) => ({ ...prev, busyKind: kind, messageKind: kind, message: '' }));
          try {
            const checked = await probePlayableAudio(file, custom.maxBytes);
            if (!checked.ok || !checked.buf) {
              setCustom((prev) => ({
                ...prev,
                busyKind: null,
                messageKind: kind,
                message: checked.reason === 'size' ? copy.tooLarge : copy.decodeFailed,
              }));
              return;
            }
            const url = `${CUSTOM_ROUTE}/${encodeURIComponent(kind)}?filename=${encodeURIComponent(file.name || '')}`;
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-sound-filename': encodeURIComponent(file.name || ''),
              },
              body: checked.buf,
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok || !payload?.ok) {
              const msg = res.status === 413
                ? copy.tooLarge
                : (res.status === 415 ? copy.unsupported : copy.uploadFailed);
              setCustom((prev) => ({ ...prev, busyKind: null, messageKind: kind, message: msg }));
              return;
            }
            const nextSlots = payload.slots && typeof payload.slots === 'object'
              ? payload.slots
              : { ...custom.slots, [kind]: payload.slot };
            setCustom((prev) => ({ ...prev, available: true, busyKind: null, messageKind: kind, message: copy.uploaded, slots: nextSlots }));
            emitUpdated(nextSlots);
            onPreview(kind, nextSlots);
          } catch {
            setCustom((prev) => ({ ...prev, busyKind: null, messageKind: kind, message: copy.unavailable }));
          }
        };

        const onReset = async (kind) => {
          if (!kind) return;
          setCustom((prev) => ({ ...prev, busyKind: kind, messageKind: kind, message: '' }));
          try {
            const res = await fetch(`${CUSTOM_ROUTE}/${encodeURIComponent(kind)}`, { method: 'DELETE' });
            const payload = await res.json().catch(() => null);
            if (!res.ok || !payload?.ok) {
              setCustom((prev) => ({ ...prev, busyKind: null, messageKind: kind, message: copy.unavailable }));
              return;
            }
            const nextSlots = payload.slots && typeof payload.slots === 'object'
              ? payload.slots
              : { ...custom.slots, [kind]: payload.slot };
            setCustom((prev) => ({ ...prev, available: true, busyKind: null, messageKind: kind, message: copy.resetDone, slots: nextSlots }));
            emitUpdated(nextSlots);
          } catch {
            setCustom((prev) => ({ ...prev, busyKind: null, messageKind: kind, message: copy.unavailable }));
          }
        };

        const commit = async () => {
          setSaving(true);
          setError('');
          try {
            const saved = snap.value && typeof snap.value === 'object' ? snap.value : {};
            const ops = [];
            const nextMuted = Boolean(current.muted);
            if (nextMuted !== Boolean(saved.muted)) ops.push({ op: 'set', path: ['muted'], value: nextMuted });
            const nextVol = typeof current.volume === 'number' ? current.volume : 0.8;
            const prevVol = typeof saved.volume === 'number' ? saved.volume : 0.8;
            if (nextVol !== prevVol) ops.push({ op: 'set', path: ['volume'], value: nextVol });
            const prevTrig = saved.triggerMode === 'always' ? 'always' : 'background';
            if (triggerMode !== prevTrig) ops.push({ op: 'set', path: ['triggerMode'], value: triggerMode });
            const prevEvents = saved.events && typeof saved.events === 'object' ? saved.events : { completed: true, failed: true, waiting: false };
            for (const k of ['completed', 'failed', 'waiting']) {
              const nv = events[k] !== undefined ? Boolean(events[k]) : (k !== 'waiting');
              const pv = prevEvents[k] !== undefined ? Boolean(prevEvents[k]) : (k !== 'waiting');
              if (nv !== pv) ops.push({ op: 'set', path: ['events', k], value: nv });
            }
            if (ops.length > 0) await saveOps(ops, snap.revision);
            dirtyRef.current = false;
            setDirty(false);
            setDraft(null);
            setSavedFlag(true);
          } catch (err) {
            setError(err?.message || String(err));
          } finally {
            setSaving(false);
          }
        };

        const rows = [
          ['completed', copy.completed, true],
          ['failed', copy.failed, true],
          ['waiting', copy.waiting, false],
        ];

        return h('div', { className: 'ns-panel' },
          error ? h('div', { className: 'ns-error' }, error) : null,
          h('div', { className: 'ns-card' },
            h('div', { className: 'ns-card__title' }, copy.title),
            h('div', { className: 'ns-card__hint' }, copy.hint),
            h('div', { className: 'ns-row' },
              h('span', null, copy.muted),
              h('label', { className: 'ns-switch' },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(current.muted),
                  'aria-label': copy.muted,
                  onChange: (e) => patchDraft({ muted: e.target.checked }),
                }),
                h('span', { className: 'ns-switch__track' }, h('span', { className: 'ns-switch__thumb' })))),
            h('div', { className: 'ns-row' },
              h('span', null, copy.triggerMode),
              h('div', { className: 'ns-seg' },
                h('button', { type: 'button', 'data-on': String(triggerMode === 'background'), onClick: () => patchDraft({ triggerMode: 'background' }) }, copy.triggerBg),
                h('button', { type: 'button', 'data-on': String(triggerMode === 'always'), onClick: () => patchDraft({ triggerMode: 'always' }) }, copy.triggerAlways))),
            h('div', { className: 'ns-field' },
              h('span', { className: 'ns-field__label' }, `${copy.volume}: ${volPct}%`),
              h('input', {
                type: 'range', min: 0, max: 100, step: 5, value: volPct,
                onChange: (e) => patchDraft({ volume: Number(e.target.value) / 100 }),
              })),
            rows.map(([kind, label, defVal]) => {
              const slot = custom.slots?.[kind];
              const hasCustom = Boolean(slot?.hasCustom);
              const sourceLabel = hasCustom && slot?.fileName ? slot.fileName : (hasPack ? copy.defaultSlot : copy.noSlot);
              const rowMsg = custom.messageKind === kind ? custom.message : '';
              const busy = custom.busyKind === kind;
              return h('div', { className: 'ns-row', key: kind },
                h('div', { className: 'ns-label' },
                  h('span', null, label),
                  h('span', { className: 'ns-sub', title: sourceLabel }, rowMsg ? `${sourceLabel} · ${rowMsg}` : sourceLabel)),
                h('div', { className: 'ns-inline' },
                  h('input', {
                    ref: (el) => { inputRefs.current[kind] = el; },
                    type: 'file',
                    accept: SOUND_ACCEPT,
                    style: { display: 'none' },
                    onChange: (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) onUpload(kind, file);
                    },
                  }),
                  h('button', {
                    type: 'button', className: 'ns-btn',
                    disabled: !custom.available || Boolean(custom.busyKind),
                    onClick: () => inputRefs.current[kind]?.click(),
                  }, busy ? copy.saving : copy.upload),
                  h('button', {
                    type: 'button', className: 'ns-btn',
                    disabled: !custom.available || !hasCustom || Boolean(custom.busyKind),
                    onClick: () => onReset(kind),
                  }, copy.reset),
                  h('button', {
                    type: 'button', className: 'ns-btn',
                    disabled: !hasCustom && !current.pack?.sounds?.[kind],
                    onClick: () => onPreview(kind),
                  }, copy.preview),
                  h('label', { className: 'ns-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: events[kind] !== undefined ? Boolean(events[kind]) : defVal,
                      'aria-label': label,
                      onChange: (e) => patchDraft({ events: { ...events, [kind]: e.target.checked } }),
                    }),
                    h('span', { className: 'ns-switch__track' }, h('span', { className: 'ns-switch__thumb' })))));
            })),
          h('button', {
            type: 'button', className: 'ns-save',
            disabled: saving,
            onClick: commit,
          }, saving ? copy.saving : (savedFlag && !dirty ? copy.saved : copy.save)));
      };
    }

    return {
      inject: ['configForms'],
      apply(ctx) {
        let stopSettingsUi;
        if (React && typeof ctx.inject === 'function') {
          const Panel = createSettingsPanelComponent(React);
          stopSettingsUi = ctx.inject(['slots', 'remote', 'remote.settings', 'locale'], (scope) => {
            const mount = () => {
              const form = ctx.configForms.get(NS);
              const locale = scope.locale || ctx.locale;
              const getLabel = () => {
                const active = locale?.getSnapshot?.()?.active || '';
                return String(active).split(/[-_]/)[0].toLowerCase() === 'zh' ? UI_COPY.zh.nav : UI_COPY.en.nav;
              };
              const saveOps = async (ops, revision) => {
                const settingsRemote = scope.remote?.settings;
                if (!settingsRemote) throw new Error('settingsRemoteUnavailable');
                const res = await settingsRemote.mutate(NS, ops, revision);
                if (res.ok) {
                  ctx.configForms.describe?.().acceptView?.(res.value);
                } else {
                  await ctx.configForms.describe?.().load?.();
                  throw new Error(res.error?.message || res.error?.code || 'persistFailed');
                }
              };
              const regStop = scope.slots.inject('settings.section', () => scope.slots.register(
                { name: 'settings.section', id: NS, order: 92, label: getLabel },
                () => React.createElement(Panel, { form, locale, saveOps }),
              ));
              let styleEl = null;
              if (typeof document !== 'undefined' && document.head) {
                styleEl = document.createElement('style');
                styleEl.setAttribute('data-plugin', NS);
                styleEl.textContent = SETTINGS_CSS;
                document.head.appendChild(styleEl);
              }
              return () => {
                try { regStop?.(); } catch {}
                try { styleEl?.remove(); } catch {}
              };
            };
            return typeof scope?.effect === 'function'
              ? scope.effect(mount, 'dsh-sound-pack-loader: settings ui')
              : mount();
          });
        }

        const stopPlayback = ctx.effect(() => {
          const form = ctx.configForms.get(NS);
          const player = createSingleChannelPlayer();
          let cfg = null;
          let customSlots = {};
          let cursor = null;
          let disposed = false;
          const lastPlayed = { completed: -Infinity, failed: -Infinity, waiting: -Infinity };

          const isActiveSource = () => Boolean(cfg && (cfg.hasPack || hasAnyCustomSlot(customSlots)));

          const applySlots = (slots) => {
            if (!slots || typeof slots !== 'object') return;
            customSlots = slots;
          };

          const refreshCustomSlots = () => {
            if (disposed || typeof fetch !== 'function') return;
            fetch(CUSTOM_ROUTE, { cache: 'no-store' })
              .then((res) => (res && res.ok ? res.json() : null))
              .then((payload) => {
                if (disposed || !payload || payload.ok !== true) return;
                applySlots(payload.slots);
              })
              .catch(() => {});
          };

          const resolveSource = (kind) => {
            const slot = customSlots && typeof customSlots === 'object' ? customSlots[kind] : null;
            if (slot && slot.hasCustom) {
              const ver = slot.updatedAt ? `?v=${encodeURIComponent(String(slot.updatedAt))}` : '';
              return `${CUSTOM_ROUTE}/${encodeURIComponent(kind)}${ver}`;
            }
            return cfg?.sounds?.[kind] || '';
          };

          const sync = () => {
            const { status, value } = form.getSnapshot();
            if (status === 'loading') return;
            cfg = status === 'ready' ? normalizeConfig(value) : null;
            if (!cfg) player.stop();
          };

          const handleEvent = (kind, now = Date.now()) => {
            if (!isActiveSource() || cfg.muted || cfg.volume <= 0) return;
            if (!cfg.events[kind]) return;
            if (cfg.triggerMode !== 'always' && !isWindowInBackground()) return;
            const src = resolveSource(kind);
            if (!src) return;
            if (now - (lastPlayed[kind] ?? -Infinity) < THROTTLE_MS) return;
            lastPlayed[kind] = now;
            player.play(src, cfg.volume);
          };

          const onPreview = (event) => {
            const detail = event?.detail;
            const kind = detail?.kind;
            if (!cfg || !kind) return;
            if (detail && typeof detail.slots === 'object' && detail.slots) {
              applySlots(detail.slots);
            }
            const src = resolveSource(kind);
            if (!src) return;
            const requestedVol = typeof detail?.volume === 'number' && Number.isFinite(detail.volume)
              ? Math.min(1, Math.max(0, detail.volume))
              : cfg.volume;
            const vol = requestedVol > 0 ? requestedVol : FALLBACK_PREVIEW_VOLUME;
            player.play(src, vol);
          };

          const onUpdated = (event) => {
            const detail = event?.detail;
            if (detail && typeof detail.slots === 'object' && detail.slots) {
              applySlots(detail.slots);
            } else {
              refreshCustomSlots();
            }
          };

          const poll = () => {
            if (disposed || !isActiveSource() || typeof fetch !== 'function') return;
            const query = cursor === null ? '' : `?since=${encodeURIComponent(String(cursor))}`;
            fetch(`${POLL_ROUTE}${query}`, { cache: 'no-store' })
              .then((res) => (res && res.ok ? res.json() : null))
              .then((payload) => {
                if (disposed || !payload || payload.ok !== true) return;
                if (typeof payload.cursor === 'number') cursor = payload.cursor;
                if (!Array.isArray(payload.events)) return;
                const now = Date.now();
                for (const evt of payload.events) {
                  if (evt && typeof evt.kind === 'string') {
                    handleEvent(evt.kind, now);
                  }
                }
              })
              .catch(() => {});
          };

          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener(PREVIEW_EVENT, onPreview);
            window.addEventListener(UPDATED_EVENT, onUpdated);
          }

          const unsub = form.subscribe(sync);
          sync();
          refreshCustomSlots();
          poll();
          const timer = setInterval(poll, POLL_MS);

          return () => {
            disposed = true;
            clearInterval(timer);
            player.stop();
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener(PREVIEW_EVENT, onPreview);
              window.removeEventListener(UPDATED_EVENT, onUpdated);
            }
            try { unsub(); } catch {}
          };
        }, 'dsh-sound-pack-loader: playback');

        return () => {
          try { stopSettingsUi?.(); } catch {}
          try { stopPlayback?.(); } catch {}
        };
      },
    };
  },
});
