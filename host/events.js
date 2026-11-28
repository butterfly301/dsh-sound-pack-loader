const MAX_QUEUE = 64;

export function classifySessionEvent(event) {
  if (!event || event.type !== 'turn/end') return null;
  const kind = event?.data?.reason?.kind;
  if (kind === 'completed') return 'completed';
  if (kind === 'error' || kind === 'max-tokens') return 'failed';
  return null;
}

export function createSoundEventTracker() {
  const queue = [];
  let nextSeq = 1;

  function handle(sessionId, event) {
    if (typeof sessionId !== 'string' || sessionId === '') return;
    const kind = classifySessionEvent(event);
    if (!kind) return;
    queue.push({
      id: nextSeq++,
      kind,
      sessionId,
      at: typeof event?.time === 'number' ? event.time : Date.now(),
    });
    if (queue.length > MAX_QUEUE) queue.shift();
  }

  function poll(sinceId = null) {
    const hasSince = sinceId !== null && sinceId !== undefined && sinceId !== '';
    const floor = hasSince && Number.isFinite(Number(sinceId)) ? Math.trunc(Number(sinceId)) : null;
    const events = floor === null ? [] : queue.filter((item) => item.id > floor);
    return {
      ok: true,
      cursor: nextSeq - 1,
      events,
    };
  }

  return { handle, poll };
}
