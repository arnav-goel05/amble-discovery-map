function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function entityContentIdentity(entity) {
  if (typeof entity?.contentHash === "string" && entity.contentHash)
    return `hash:${entity.contentHash}`;
  return `value:${JSON.stringify(canonical(entity))}`;
}

export function landmarkInputIdentity(landmark, sourceEvents) {
  if (typeof landmark?.contentHash === "string" && landmark.contentHash)
    return `hash:${landmark.contentHash}`;
  return entityContentIdentity({ landmark, sourceEvents });
}

function indexLandmarks(landmarks, label) {
  if (!Array.isArray(landmarks))
    throw new TypeError(`${label} landmarks must be an array`);
  const result = new Map();
  for (const landmark of landmarks) {
    if (!landmark?.id) throw new Error(`${label} landmark identity is missing`);
    if (result.has(landmark.id))
      throw new Error(`Duplicate landmark identity: ${landmark.id}`);
    const events = Array.isArray(landmark.events) ? landmark.events : [];
    const eventIds = events.map((event) => event?.id);
    if (
      eventIds.some((id) => !id) ||
      new Set(eventIds).size !== eventIds.length
    )
      throw new Error(`Duplicate event identity in landmark ${landmark.id}`);
    const logical = new Map();
    for (const event of events) {
      const key = event.publishedEventId ?? event.identityAnchor ?? event.id;
      const current = logical.get(key);
      if (!current) logical.set(key, event);
      else
        logical.set(key, {
          ...current,
          sessions: [
            ...new Map(
              [...(current.sessions ?? []), ...(event.sessions ?? [])].map(
                (item) => [item.sessionId ?? JSON.stringify(item), item],
              ),
            ).values(),
          ],
          venueOccurrences: [
            ...new Map(
              [
                ...(current.venueOccurrences ?? []),
                ...(event.venueOccurrences ?? []),
              ].map((item) => [
                item.venueOccurrenceId ?? JSON.stringify(item),
                item,
              ]),
            ).values(),
          ],
          sourceContributions: [
            ...new Map(
              [
                ...(current.sourceContributions ?? []),
                ...(event.sourceContributions ?? []),
              ].map((item) => [
                item.sourceRecordId ?? JSON.stringify(item),
                item,
              ]),
            ).values(),
          ],
        });
    }
    result.set(
      landmark.id,
      logical.size === events.length
        ? landmark
        : { ...landmark, events: [...logical.values()] },
    );
  }
  return result;
}

export function reconcileEventMap(previousLandmarks = [], nextLandmarks = []) {
  const previous = indexLandmarks(previousLandmarks, "Previous");
  const next = indexLandmarks(nextLandmarks, "Next");
  const actions = [];
  const landmarks = [];
  for (const [id, incoming] of next) {
    const current = previous.get(id);
    if (!current) {
      actions.push({ id, action: "create" });
      landmarks.push(incoming);
    } else if (
      entityContentIdentity(current) === entityContentIdentity(incoming)
    ) {
      actions.push({ id, action: "noop" });
      landmarks.push(current);
    } else {
      actions.push({ id, action: "update" });
      landmarks.push(incoming);
    }
  }
  for (const id of previous.keys())
    if (!next.has(id)) actions.push({ id, action: "remove" });
  return { actions, landmarks };
}
