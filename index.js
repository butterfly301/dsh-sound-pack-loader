import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSoundEventTracker } from './host/events.js';
import {
  MAX_SOUND_BYTES,
  createSoundStore,
  isValidSoundKind,
} from './host/sound-store.js';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
function loadSchemastery() {
  try {
    return hostRoot
      ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
      : localRequire('@deepseek-ai/schemastery');
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND' || !String(err.message).includes('@deepseek-ai/schemastery')) {
      throw err;
    }
    const chain = () => ({ default: chain, min: chain, max: chain, pattern: chain, volatile: chain });
    return { object: chain, string: chain, number: chain, boolean: chain, array: chain, dict: chain, union: chain, const: chain };
  }
}
const schemastery = loadSchemastery();
const z = schemastery.default ?? schemastery;

const BASE_ROUTE = '/sound-pack-loader';
const LOCALE_ROOT = resolve(fileURLToPath(new URL('./locale/', import.meta.url)));
const LANG_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const POLL_ROUTE = `${BASE_ROUTE}/poll`;
const CUSTOM_ROUTE = `${BASE_ROUTE}/custom`;
const CUSTOM_PREFIX = `${CUSTOM_ROUTE}/`;

const pack = z.object({
  sounds: z.object({
    completed: z.string().default(''),
    failed: z.string().default(''),
    waiting: z.string().default(''),
  }).default({}),
});

export const Config = z.object({
  muted: z.boolean().default(false).volatile(),
  volume: z.number().min(0).max(1).default(0.8).volatile(),
  triggerMode: z.union([z.const('background'), z.const('always')]).default('background').volatile(),
  events: z.object({
    completed: z.boolean().default(true),
    failed: z.boolean().default(true),
    waiting: z.boolean().default(false),
  }).default({ completed: true, failed: true, waiting: false }).volatile(),
  pack: z.union([z.const(false), pack]).default(false).volatile(),
});

export function readService(ctx, key) {
  try {
    if (typeof ctx?.get === 'function') return ctx.get(key);
    if (ctx?.reflect && typeof ctx.reflect.get === 'function') return ctx.reflect.get(key);
  } catch {}
  return undefined;
}

function dataDirOf(ctx) {
  const homePath = readService(ctx, 'dshHomePath');
  if (typeof homePath === 'function') {
    try {
      const resolved = homePath('sound-pack-loader');
      if (typeof resolved === 'string' && resolved !== '') return resolved;
    } catch {}
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'sound-pack-loader');
}

function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readBinaryBody(req, limitBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error('audio file exceeds 2 MB limit');
        err.status = 413;
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolvePromise(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function decodeHeaderFilename(req, url) {
  const fromQuery = url.searchParams.get('filename');
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery;
  const header = req.headers?.['x-sound-filename'];
  if (typeof header === 'string' && header.trim()) {
    try {
      return decodeURIComponent(header);
    } catch {
      return header;
    }
  }
  return '';
}

function rejectCrossSite(req, res, webServer) {
  const site = req.headers?.['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    res.writeHead(403, { 'x-content-type-options': 'nosniff' });
    res.end();
    return true;
  }
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && origin !== '') {
    let expected = null;
    try { expected = typeof webServer?.getOrigin === 'function' ? webServer.getOrigin() : null; } catch {}
    if (expected && origin !== expected) {
      res.writeHead(403, { 'x-content-type-options': 'nosniff' });
      res.end();
      return true;
    }
  }
  return false;
}

export function apply(ctx) {
  const tracker = createSoundEventTracker();
  const offSessionEvent = typeof ctx.on === 'function'
    ? ctx.on('session/event', (session, event) => tracker.handle(session?.id, event))
    : undefined;
  ctx.effect(() => () => { try { offSessionEvent?.(); } catch {} }, 'dsh-sound-pack-loader: session events');

  ctx.inject(['settings'], (scope) => scope.effect(
    () => scope.settings.configure({ auto: false }, ctx.fiber),
  ));

  ctx.inject(['webServer'], (scope) => scope.effect(() => {
    const soundStore = createSoundStore({ dir: dataDirOf(scope) });

    const unregister = scope.webServer.register({
      kind: 'prefix',
      path: BASE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD' && rejectCrossSite(req, res, scope.webServer)) return;
        let url;
        try {
          url = new URL(req.url ?? BASE_ROUTE, 'http://dsh.local');
        } catch {
          res.writeHead(400, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }

        const pathname = url.pathname;
        const isRead = req.method === 'GET' || req.method === 'HEAD';

        if (pathname.startsWith(`${BASE_ROUTE}/locale/`) && pathname.endsWith('.json')) {
          if (!isRead) {
            res.writeHead(405, { 'x-content-type-options': 'nosniff' });
            res.end();
            return;
          }
          let lang;
          try {
            lang = decodeURIComponent(pathname.slice(`${BASE_ROUTE}/locale/`.length, -5));
          } catch {
            res.writeHead(400, { 'x-content-type-options': 'nosniff' });
            res.end();
            return;
          }
          if (!LANG_RE.test(lang)) {
            res.writeHead(400, { 'x-content-type-options': 'nosniff' });
            res.end();
            return;
          }
          const candidates = [lang.toLowerCase(), lang.toLowerCase().split('-')[0], 'en'].filter((id, index, all) => all.indexOf(id) === index);
          for (const id of candidates) {
            try {
              const raw = await readFile(join(LOCALE_ROOT, `${id}.json`), 'utf8');
              const data = JSON.parse(raw);
              sendJson(req, res, 200, { lang: id, ui: data && typeof data.ui === 'object' ? data.ui : {} });
              return;
            } catch (error) {
              if (error?.code !== 'ENOENT') {
                sendJson(req, res, 500, { ok: false, error: 'locale read failed' });
                return;
              }
            }
          }
          sendJson(req, res, 404, { ok: false, error: 'locale not found' });
          return;
        }

        if (pathname === POLL_ROUTE) {
          if (!isRead) {
            res.writeHead(405, { 'x-content-type-options': 'nosniff' });
            res.end();
            return;
          }
          const since = url.searchParams.get('since');
          const payload = tracker.poll(since);
          sendJson(req, res, 200, payload);
          return;
        }

        if (pathname === CUSTOM_ROUTE) {
          if (!isRead) {
            res.writeHead(405, { 'x-content-type-options': 'nosniff' });
            res.end();
            return;
          }
          try {
            const slots = await soundStore.inspectAll();
            sendJson(req, res, 200, { ok: true, maxBytes: MAX_SOUND_BYTES, slots });
          } catch (error) {
            sendJson(req, res, 500, { ok: false, error: error?.message || 'inspect failed' });
          }
          return;
        }

        if (pathname.startsWith(CUSTOM_PREFIX)) {
          const kind = pathname.slice(CUSTOM_PREFIX.length);
          if (!isValidSoundKind(kind)) {
            sendJson(req, res, 404, { ok: false, error: 'unknown sound slot' });
            return;
          }

          if (isRead) {
            try {
              const audio = await soundStore.readAudio(kind);
              if (!audio) {
                res.writeHead(204, {
                  'x-content-type-options': 'nosniff',
                  'cache-control': 'no-store',
                });
                res.end();
                return;
              }
              res.writeHead(200, {
                'x-content-type-options': 'nosniff',
                'cache-control': 'no-store',
                'content-length': String(audio.buffer.byteLength),
                'content-type': audio.mime,
              });
              res.end(req.method === 'HEAD' ? undefined : audio.buffer);
            } catch (error) {
              sendJson(req, res, 500, { ok: false, error: error?.message || 'read failed' });
            }
            return;
          }

          if (req.method === 'POST') {
            try {
              const body = await readBinaryBody(req, MAX_SOUND_BYTES);
              const fileName = decodeHeaderFilename(req, url);
              const slot = await soundStore.saveAudio(kind, body, fileName);
              const slots = await soundStore.inspectAll();
              sendJson(req, res, 200, { ok: true, kind, slot, slots });
            } catch (error) {
              const status = typeof error?.status === 'number' ? error.status : 500;
              sendJson(req, res, status, { ok: false, error: error?.message || 'upload failed' });
            }
            return;
          }

          if (req.method === 'DELETE') {
            try {
              const slot = await soundStore.clearAudio(kind);
              const slots = await soundStore.inspectAll();
              sendJson(req, res, 200, { ok: true, kind, slot, slots });
            } catch (error) {
              const status = typeof error?.status === 'number' ? error.status : 500;
              sendJson(req, res, status, { ok: false, error: error?.message || 'clear failed' });
            }
            return;
          }

          res.writeHead(405, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }

        res.writeHead(404, { 'x-content-type-options': 'nosniff' });
        res.end();
      },
    });

    return () => {
      unregister();
    };
  }, 'dsh-sound-pack-loader: routes'));
}
