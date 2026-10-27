const assert = require('node:assert/strict');
const profiles = Object.freeze({
  mostrador: {
    readers: 4,
    readerPauseMs: 1500,
    businessPauseMs: 3000,
    financialPauseMs: 30000,
    sqlPauseMs: 60,
    duration: 120,
  },
  operaciones: {
    readers: 8,
    readerPauseMs: 1500,
    businessPauseMs: 2000,
    financialPauseMs: 20000,
    sqlPauseMs: 30,
    duration: 120,
  },
  soak: {
    readers: 8,
    readerPauseMs: 2000,
    businessPauseMs: 3000,
    financialPauseMs: 30000,
    sqlPauseMs: 60,
    duration: 600,
  },
});
const goals = Object.freeze({
  readP95Ms: 500,
  eventLoopP95Ms: 100,
  rssGrowthBytes: 128 * 1024 * 1024,
});
function selectProfile(name) {
  assert.ok(
    Object.hasOwn(profiles, name),
    'Perfil desconocido: mostrador, operaciones o soak',
  );
  return { name, ...profiles[name] };
}
function evaluate(group, memorySamples) {
  assert.ok(memorySamples.length >= 4, 'Muestras de memoria insuficientes');
  const quarter = Math.max(1, Math.floor(memorySamples.length / 4));
  const mean = (xs) => xs.reduce((sum, n) => sum + n, 0) / xs.length;
  const firstRssMean = mean(memorySamples.slice(0, quarter));
  const lastRssMean = mean(memorySamples.slice(-quarter));
  const rssGrowthBytes = Math.max(0, lastRssMean - firstRssMean);
  const checks = {
    readP95: Number.isFinite(group.p95) && group.p95 <= goals.readP95Ms,
    eventLoopP95:
      Number.isFinite(group.eventLoopP95Ms) &&
      group.eventLoopP95Ms <= goals.eventLoopP95Ms,
    rssGrowth: rssGrowthBytes <= goals.rssGrowthBytes,
    readsAndWrites:
      group.requests > 0 &&
      group.writerCommits > 0 &&
      group.financialCycles > 0,
    integrity:
      group.errors === 0 &&
      group.idleTransactions === 0 &&
      group.postgres.countersDelta.deadlocks === 0,
  };
  return {
    scope:
      'Objetivos provisionales de regresión local; no SLA productivo ni certificación de fuga de memoria',
    goals,
    firstRssMean,
    lastRssMean,
    rssGrowthBytes,
    samples: memorySamples.length,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}
function evaluateExtended(group, seconds) {
  assert.ok(Number.isInteger(seconds) && seconds >= 40 && seconds <= 3600);
  const expectedMinutes = Math.ceil(seconds / 60);
  const windows = group.readWindows ?? [];
  const checks = {
    duration: group.elapsedMs >= seconds * 1000,
    everyMinuteCovered: Array.from({ length: expectedMinutes }, (_, minute) =>
      windows.some((window) => window.minute === minute && window.requests > 0),
    ).every(Boolean),
    everyMinuteP95:
      windows.length > 0 &&
      windows.every(
        (window) =>
          Number.isFinite(window.p95) && window.p95 <= goals.readP95Ms,
      ),
  };
  return {
    expectedMinutes,
    checks,
    passed: Object.values(checks).every(Boolean),
    scope:
      'Cobertura temporal y p95 por minuto; mismos objetivos provisionales, sin certificar SLA productivo',
  };
}
module.exports = { selectProfile, evaluate, evaluateExtended };
