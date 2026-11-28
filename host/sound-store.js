import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_SOUND_BYTES = 2 * 1024 * 1024;
export const SOUND_KINDS = Object.freeze(['completed', 'failed', 'waiting']);

const KIND_SET = new Set(SOUND_KINDS);

const FORMATS = Object.freeze([
  { ext: 'wav', mime: 'audio/wav' },
  { ext: 'mp3', mime: 'audio/mpeg' },
  { ext: 'ogg', mime: 'audio/ogg' },
  { ext: 'flac', mime: 'audio/flac' },
  { ext: 'm4a', mime: 'audio/mp4' },
  { ext: 'webm', mime: 'audio/webm' },
]);

export function isValidSoundKind(kind) {
  return typeof kind === 'string' && KIND_SET.has(kind);
}

export function sanitizeSoundFileName(raw) {
  if (typeof raw !== 'string') return '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleaned) return '';
  return [...cleaned].slice(0, 120).join('');
}

export function detectAudioFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 12) return null;

  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return FORMATS[0];
  }

  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return FORMATS[1];
  }
  if (
    buffer[0] === 0xFF
    && (buffer[1] & 0xE0) === 0xE0
    && (buffer[1] & 0x18) !== 0x08
    && (buffer[1] & 0x06) !== 0x00
  ) {
    return FORMATS[1];
  }

  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return FORMATS[2];
  }

  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') {
    return FORMATS[3];
  }

  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const boxSize = buffer.readUInt32BE(0);
    if (boxSize >= 16 && boxSize <= buffer.byteLength) {
      return FORMATS[4];
    }
  }

  if (
    buffer[0] === 0x1A
    && buffer[1] === 0x45
    && buffer[2] === 0xDF
    && buffer[3] === 0xA3
  ) {
    return FORMATS[5];
  }

  return null;
}

function emptySlot() {
  return { hasCustom: false, fileName: '', mime: null, updatedAt: null };
}

export function createSoundStore({ dir }) {
  const metaPath = dir ? join(dir, 'meta.json') : null;

  async function readMeta() {
    if (!metaPath) return {};
    try {
      const raw = await readFile(metaPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async function writeMeta(meta) {
    if (!metaPath || !dir) return;
    await mkdir(dir, { recursive: true });
    const tmp = `${metaPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    await rename(tmp, metaPath);
  }

  async function findExisting(kind) {
    if (!dir || !isValidSoundKind(kind)) return null;
    for (const fmt of FORMATS) {
      const filePath = join(dir, `${kind}.${fmt.ext}`);
      try {
        const info = await stat(filePath);
        if (info.isFile()) {
          return { ...fmt, filePath, updatedAt: Math.trunc(info.mtimeMs) };
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async function removeKindFiles(kind, keepExt = null) {
    if (!dir || !isValidSoundKind(kind)) return;
    for (const fmt of FORMATS) {
      if (keepExt && fmt.ext === keepExt) continue;
      try {
        await unlink(join(dir, `${kind}.${fmt.ext}`));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  async function inspectKind(kind, meta) {
    const hit = await findExisting(kind);
    if (!hit) return emptySlot();
    const record = meta && typeof meta[kind] === 'object' ? meta[kind] : null;
    const fileName = sanitizeSoundFileName(record?.fileName) || `${kind}.${hit.ext}`;
    return {
      hasCustom: true,
      fileName,
      mime: hit.mime,
      updatedAt: hit.updatedAt,
    };
  }

  return {
    async inspectAll() {
      const meta = await readMeta();
      const slots = {};
      for (const kind of SOUND_KINDS) {
        slots[kind] = await inspectKind(kind, meta);
      }
      return slots;
    },

    async readAudio(kind) {
      if (!isValidSoundKind(kind)) return null;
      const hit = await findExisting(kind);
      if (!hit) return null;
      const meta = await readMeta();
      const record = meta && typeof meta[kind] === 'object' ? meta[kind] : null;
      const buffer = await readFile(hit.filePath);
      return {
        buffer,
        mime: hit.mime,
        fileName: sanitizeSoundFileName(record?.fileName) || `${kind}.${hit.ext}`,
        updatedAt: hit.updatedAt,
      };
    },

    async saveAudio(kind, buffer, rawFileName = '') {
      if (!dir) {
        const err = new Error('sound storage directory unavailable');
        err.status = 500;
        throw err;
      }
      if (!isValidSoundKind(kind)) {
        const err = new Error('unknown sound slot');
        err.status = 400;
        throw err;
      }
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        const err = new Error('empty audio payload');
        err.status = 400;
        throw err;
      }
      if (buffer.byteLength > MAX_SOUND_BYTES) {
        const err = new Error('audio file exceeds 2 MB limit');
        err.status = 413;
        throw err;
      }
      const fmt = detectAudioFormat(buffer);
      if (!fmt) {
        const err = new Error('unsupported audio format');
        err.status = 415;
        throw err;
      }
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${kind}.${fmt.ext}`);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, buffer);
      await rename(tmp, target);
      await removeKindFiles(kind, fmt.ext);
      const info = await stat(target);
      const updatedAt = Math.trunc(info.mtimeMs);
      const fileName = sanitizeSoundFileName(rawFileName) || `${kind}.${fmt.ext}`;
      const meta = await readMeta();
      meta[kind] = { fileName, ext: fmt.ext, mime: fmt.mime, updatedAt };
      await writeMeta(meta);
      return {
        hasCustom: true,
        fileName,
        mime: fmt.mime,
        updatedAt,
      };
    },

    async clearAudio(kind) {
      if (!isValidSoundKind(kind)) {
        const err = new Error('unknown sound slot');
        err.status = 400;
        throw err;
      }
      await removeKindFiles(kind);
      const meta = await readMeta();
      if (Object.prototype.hasOwnProperty.call(meta, kind)) {
        delete meta[kind];
        await writeMeta(meta);
      }
      return emptySlot();
    },
  };
}
