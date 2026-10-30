import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateIntakeProfile, loadIntakeProfile, checkIntakeProfile, prepareIntakeProfile } from "../intake-profile.mjs";
import { createBridgePreflight } from "../lead-preflight.mjs";
import { profileFixture } from "./intake-profile.fixture.mjs";
// Rutas absolutas: la suite corre desde la raíz (npm run test:web-publica) o desde public-web (npm test).
const serverScript = fileURLToPath(new URL("../server.mjs", import.meta.url));
const intakeScript = fileURLToPath(new URL("../intake-profile.mjs", import.meta.url));
import { createPreviewServer } from "../server.mjs";
import { build } from "../build.mjs";

test("perfil cerrado no lee claves, no consulta puente y no habilita formulario", async () => {
  const closed = await loadIntakeProfile();
  assert.equal(closed.enabled, false);
  const env = new Proxy({}, { get() { throw new Error("No leer secretos estando cerrado"); } });
  assert.equal(await prepareIntakeProfile(closed, env), undefined);
  assert.equal((await checkIntakeProfile(closed, env, true)).status, "closed");
  const directory = await mkdtemp(join(tmpdir(), "rtt-profile-closed-"));
  let server;
  try {
    await build(directory);
    const intake = await prepareIntakeProfile(closed, env);
    server = await createPreviewServer(directory, { intake });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(origin + "/solicitar")).status, 503);
    assert.equal((await fetch(origin + "/solicitudes", { method: "POST", body: "{}" })).status, 503);
    for (const path of ["/capture-profile.json", "/capture-profile.local.json", "/intake-profile.mjs"])
      assert.equal((await fetch(origin + path)).status, 404);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test("perfil habilitado exige origen local, aprobaciones ligadas al texto y retenciones declaradas", () => {
  const original = profileFixture();
  const result = validateIntakeProfile(original);
  original.privacy.text = "alteración";
  assert.notEqual(result.privacy.text, original.privacy.text);
  const good = profileFixture();
  for (const bad of [{ ...good, secret: "no admitir" }, { ...good, enabled: "true" }, { ...good, mode: "production" },
    { ...good, origin: "https://example.com" }, { ...good, origin: "http://localhost:4500" },
    { ...good, origin: "http://127.0.0.1:4500/" }, { ...good, bridgeOrigin: good.origin },
    { ...good, keyId: "legacy" }, { ...good, privacy: { ...good.privacy, approved: false } },
    { ...good, privacy: { ...good.privacy, text: "texto modificado" } }, { ...good, privacy: { ...good.privacy, reviewedAt: "2999-01-01T00:00:00.000Z" } },
    { ...good, retention: { ...good.retention, approved: false } }, { ...good, retention: { ...good.retention, inboxDays: 30 } },
    { ...good, retention: { ...good.retention, metadataPolicy: "" } }, { ...good, retention: { ...good.retention, backupPolicy: "" } }])
    assert.throws(() => validateIntakeProfile(bad), /Perfil/);
});

test("perfil y claves inválidos cierran con errores sanitizados; archivo acotado y CLI no revela valores", async () => {
  const profile = profileFixture();
  const key = randomBytes(32).toString("base64"), stable = randomBytes(32).toString("base64");
  for (const env of [{}, { PUBLIC_WEB_BRIDGE_KEY: key, PUBLIC_WEB_FINGERPRINT_KEY: key },
    { PUBLIC_WEB_BRIDGE_KEY: " " + key, PUBLIC_WEB_FINGERPRINT_KEY: stable }])
    await assert.rejects(checkIntakeProfile(profile, env), /Perfil/);
  const env = { PUBLIC_WEB_BRIDGE_KEY: key, PUBLIC_WEB_FINGERPRINT_KEY: stable };
  const report = await checkIntakeProfile(profile, env);
  assert.equal(report.status, "prepared-local"); assert.equal(report.backendChecked, false); assert.equal(report.captureStarted, false);
  for (const value of [key, stable, profile.privacy.text, profile.privacy.reviewer]) assert.ok(!JSON.stringify(report).includes(value));
  const directory = await mkdtemp(join(tmpdir(), "rtt-profile-file-"));
  try {
    const file = join(directory, "profile.json");
    await writeFile(file, JSON.stringify(profile));
    assert.deepEqual(await loadIntakeProfile(file), profile);
    await assert.rejects(loadIntakeProfile(directory), /Perfil/);
    await writeFile(file, Buffer.alloc(65537, 65));
    await assert.rejects(loadIntakeProfile(file), /Perfil/);
    await writeFile(file, Buffer.from([0xff])); await assert.rejects(loadIntakeProfile(file), /Perfil/);
    await writeFile(file, JSON.stringify({ secret: key }));
    const command = spawnSync(process.execPath, [intakeScript, "--profile=" + file], { encoding: "utf8" });
    assert.equal(command.status, 1); assert.ok(!command.stdout.includes(key)); assert.ok(!command.stderr.includes(key));
    assert.doesNotMatch(command.stderr, /ERR_MODULE_NOT_FOUND/);
    const server = spawnSync(process.execPath, [serverScript, "--capture-profile=" + file], { encoding: "utf8" });
    assert.equal(server.status, 1); assert.ok(!server.stderr.includes(key));
    assert.doesNotMatch(server.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("comprobación usa dominio propio, prueba ambas claves y autentica recibo/nonce sin contactos", async () => {
  const signing = randomBytes(32), fingerprint = randomBytes(32);
  const env = { PUBLIC_WEB_BRIDGE_KEY: signing.toString("base64"), PUBLIC_WEB_FINGERPRINT_KEY: fingerprint.toString("base64") };
  let mode = "ok", calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8"), body = JSON.parse(raw);
    assert.equal(req.url, "/api/v1/web-lead-bridge/check");
    assert.deepEqual(Object.keys(body).sort(), ["schemaVersion", "nonce", "privacyVersion", "fingerprintProof"].sort());
    const timestamp = req.headers["x-web-timestamp"];
    assert.equal(req.headers["x-web-signature"], createHmac("sha256", signing).update(`web-lead-check-v2\nfixture-3\n${timestamp}\n${raw}`).digest("hex"));
    assert.equal(body.fingerprintProof, createHmac("sha256", fingerprint).update(`web-lead-fingerprint-check-v1\n${body.nonce}\nfixture-v1`).digest("hex"));
    if (mode === "redirect") { res.writeHead(302, { Location: "https://example.com" }); res.end(); return; }
    const receipt = { checked: true, nonce: mode === "nonce" ? "a".repeat(64) : body.nonce, privacyVersion: "fixture-v1", inboxDays: mode === "retention" ? 30 : 90 };
    const response = mode === "large" ? " ".repeat(4097) : JSON.stringify(receipt);
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Web-Timestamp", mode === "timestamp" ? "0" : timestamp);
    res.setHeader("X-Web-Signature", mode === "signature" ? "f".repeat(64) : createHmac("sha256", signing).update(`web-lead-check-response-v2\nfixture-3\n${timestamp}\n${response}`).digest("hex"));
    res.end(response);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const profile = profileFixture(undefined, `http://127.0.0.1:${server.address().port}`);
    assert.equal((await checkIntakeProfile(profile, env, true)).status, "checked-local");
    const intake = await prepareIntakeProfile(profile, env);
    assert.equal(intake.privacyVersion, "fixture-v1"); assert.deepEqual(intake.key, fingerprint);
    for (mode of ["nonce", "signature", "timestamp", "retention", "large", "redirect"])
      await assert.rejects(prepareIntakeProfile(profile, env), /puente no confirmado/);
    assert.equal(calls, 8);
    assert.throws(() => createBridgePreflight(profile.bridgeOrigin, signing, signing, "fixture-3"), /configuración/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("CLI exige perfil explícito: cerrado aun con variables; habilitado hace preflight antes de servir y enviar", async () => {
  const signing = randomBytes(32), fingerprint = randomBytes(32);
  const directory = await mkdtemp(join(tmpdir(), "rtt-profile-cli-"));
  const file = join(directory, "profile.json");
  let child, checks = 0, refuse = false;
  const received = [];
  const bridge = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8"), data = JSON.parse(raw), timestamp = req.headers["x-web-timestamp"];
    const checking = req.url === "/api/v1/web-lead-bridge/check";
    if (checking) checks++;
    const prefix = checking ? "web-lead-check-v2" : "web-lead-v2";
    const signature = createHmac("sha256", signing).update(`${prefix}\nfixture-3\n${timestamp}\n${raw}`).digest("hex");
    if (refuse || signature !== req.headers["x-web-signature"]) { res.writeHead(401); res.end(); return; }
    let body;
    if (checking) body = JSON.stringify({ checked: true, nonce: data.nonce, privacyVersion: "fixture-v1", inboxDays: 90 });
    else { received.push(data); body = JSON.stringify({ received: true, requestId: data.lead.requestId }); }
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Web-Timestamp", timestamp);
    if (checking) res.setHeader("X-Web-Signature", createHmac("sha256", signing).update(`web-lead-check-response-v2\nfixture-3\n${timestamp}\n${body}`).digest("hex"));
    res.end(body);
  });
  bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
  const reserve = createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PUBLIC_WEB_PORT: String(port), PUBLIC_WEB_BRIDGE_KEY: signing.toString("base64"),
    PUBLIC_WEB_FINGERPRINT_KEY: fingerprint.toString("base64"), WEB_LEAD_BRIDGE_ENABLED: "true" };
  const stop = async () => {
    if (child && child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
    child = undefined;
  };
  const start = async (args) => {
    child = spawn(process.execPath, [serverScript, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr.resume();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CLI no inició a tiempo")), 10000);
      let output = "";
      child.stdout.on("data", chunk => { output += chunk.toString(); if (output.includes("Vista previa local:")) { clearTimeout(timer); resolve(); } });
      child.once("error", () => { clearTimeout(timer); reject(new Error("CLI no inició")); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("CLI cerró antes de servir")); });
    });
  };
  try {
    await start([]);
    assert.equal((await fetch(origin + "/solicitar")).status, 503); assert.equal(checks, 0);
    await stop();
    const profile = profileFixture(origin, `http://127.0.0.1:${bridge.address().port}`);
    await writeFile(file, JSON.stringify({ ...profile, enabled: false }));
    await start(["--capture-profile=" + file]);
    assert.equal((await fetch(origin + "/solicitar")).status, 503); assert.equal(checks, 0);
    await stop();
    await writeFile(file, JSON.stringify(profile));
    await start(["--capture-profile=" + file]);
    assert.equal(checks, 1); assert.equal((await fetch(origin + "/solicitar")).status, 200);
    const fields = new URLSearchParams({ requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", privacyVersion: "fixture-v1", privacyAccepted: "yes",
      name: "Contacto fixture CLI", channel: "email", value: "fixture@example.com", code: "CLI-FIXTURE", quantity: "2" });
    const response = await fetch(origin + "/solicitudes", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: fields.toString() });
    assert.equal(response.status, 202); assert.equal(received.length, 1); assert.equal(received[0].lead.items[0].code, "CLI-FIXTURE");
    const { requestId, ...payload } = received[0].lead;
    assert.equal(received[0].fingerprint, createHmac("sha256", fingerprint).update(JSON.stringify(payload)).digest("hex"));
    assert.equal((await fetch(origin + "/capture-profile.json")).status, 404);
    await stop();
    refuse = true;
    await assert.rejects(start(["--capture-profile=" + file]), /CLI cerró/);
    await assert.rejects(fetch(origin + "/solicitar"), /fetch failed/);
    assert.equal(received.length, 1, "Comprobación fallida nunca envió un contacto");
  } finally { await stop(); await new Promise(resolve => bridge.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
