const MAX_QUEUE = 64;
const WAITING_EVENT_TYPES = new Set([
  'tool/approval-requested',
  'approval/requested',
  'permission/request',
  'permission/requested',
  'user/confirmation-requested',
  'assistant/waiting',
]);

export function classifySessionEvent(event) {
  const type = event?.type;
  if (!type) return null;
  if (type === 'turn/end') {
    const kind = event?.data?.reason?.kind;
    if (kind === 'completed') return 'completed';
    if (kind === 'error' || kind === 'max-tokens') return 'failed';
    if (kind === 'waiting' || kind === 'approval' || kind === 'needs-input') return 'waiting';
    // aborted / interrupted -> user cancelled -> stay silent
    return null;
  }
  if (WAITING_EVENT_TYPES.has(type)) return 'waiting';
  return null;
}

function listLiveSessions(sessionsService) {
  if (!sessionsService) return [];
  if (typeof sessionsService.values === 'function') return [...sessionsService.values()];
  if (sessionsService instanceof Map) return [...sessionsService.values()];
  if (Array.isArray(sessionsService)) return sessionsService;
  if (typeof sessionsService.list === 'function') return sessionsService.list() || [];
  const snap = sessionsService.list?.getSnapshot?.();
  if (snap?.byId && typeof snap.byId === 'object') return Object.values(snap.byId);
  return [];
}

function eventAtOf(session, seq) {
  if (typeof session?.eventAt === 'function') return session.eventAt(seq);
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents(seq, seq + 1)[0];
  return undefined;
}

export function createSoundEventTracker() {
  const cursors = new Map();
  const queue = [];
  let nextSeq = 1;
  let initialized = false;

  function scan(sessionsService) {
    const sessions = listLiveSessions(sessionsService);
    const seenIds = new Set();
    for (const session of sessions) {
      const id = session?.id;
      if (typeof id !== 'string' || !id) continue;
      seenIds.add(id);
      const end = typeof session.seq === 'number' && Number.isFinite(session.seq) ? Math.trunc(session.seq) : 0;
      if (!cursors.has(id)) {
        // On initial boot, start at current seq so past events don't chime;
        // for newly created sessions after boot, scan from 0.
        cursors.set(id, initialized ? 0 : end);
      }
      let cursor = cursors.get(id);
      if (cursor > end) cursor = 0;
      for (let seq = cursor; seq < end; seq += 1) {
        const evt = eventAtOf(session, seq);
        const kind = classifySessionEvent(evt);
        if (kind) {
          queue.push({
            id: nextSeq++,
            kind,
            sessionId: id,
            at: typeof evt?.time === 'number' ? evt.time : Date.now(),
          });
          if (queue.length > MAX_QUEUE) queue.shift();
        }
      }
      cursors.set(id, end);
    }
    for (const id of cursors.keys()) {
      if (!seenIds.has(id)) cursors.delete(id);
    }
    initialized = true;
  }

  function poll(sessionsService, sinceId = null) {
    scan(sessionsService);
    const hasSince = sinceId !== null && sinceId !== undefined && sinceId !== '';
    const floor = hasSince && Number.isFinite(Number(sinceId)) ? Math.trunc(Number(sinceId)) : null;
    const events = floor === null ? [] : queue.filter((item) => item.id > floor);
    return {
      ok: true,
      cursor: nextSeq - 1,
      events,
    };
  }

  return { scan, poll };
}
