export function createRequestLimits({
  requests = 60,
  windowMs = 60000,
  clients = 1000,
  now = Date.now,
} = {}) {
  if (
    ![requests, windowMs, clients].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    typeof now !== "function"
  )
    throw new Error("Límites inválidos");
  const counters = new Map();
  return (address) => {
    const time = now();
    for (const [key, value] of counters)
      if (value.expires <= time) counters.delete(key);
    let counter = counters.get(address);
    if (!counter) {
      if (counters.size >= clients)
        return { status: 503, retryAfter: Math.ceil(windowMs / 1000) };
      counter = { count: 0, expires: time + windowMs };
      counters.set(address, counter);
    }
    if (counter.count >= requests)
      return {
        status: 429,
        retryAfter: Math.max(1, Math.ceil((counter.expires - time) / 1000)),
      };
    counter.count++;
    return { status: 200 };
  };
}
