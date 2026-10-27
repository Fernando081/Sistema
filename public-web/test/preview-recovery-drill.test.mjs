import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "../build.mjs";
import { hash } from "../release.mjs";
import { backupPreview, verifyPreviewArchive } from "../preview-backup.mjs";
import { runPreviewRecoveryDrill } from "../preview-recovery-drill.mjs";
import { loadSavedBackup } from "../check-saved-backup.mjs";

async function fixture(run) {
  const temporary = await mkdtemp(join(tmpdir(), "rtt-drill-test-"));
  try {
    const sourceDirectory = join(temporary, "source");
    const backupDirectory = join(temporary, "backups");
    await mkdir(backupDirectory);
    await build(sourceDirectory);
    const archive = await backupPreview(sourceDirectory);
    const filename = `web-preview-${randomUUID()}.json`;
    const raw = JSON.stringify(archive);
    await writeFile(join(backupDirectory, filename), raw, { flag: "wx" });
    await run({ temporary, sourceDirectory, backupDirectory, archive, filename, expectedHash: hash(raw) });
  } finally {
    const path = await realpath(temporary);
    const base = await realpath(tmpdir());
    if (path.startsWith(base + sep) && basename(path).startsWith("rtt-drill-test-"))
      await rm(path, { recursive: true, force: true });
  }
}

test("simulacro usa el respaldo guardado, detecta pérdida en copia y conserva fuente/bytes", async () => {
  await fixture(async context => {
    const before = await readdir(context.sourceDirectory);
    await writeFile(join(context.sourceDirectory, "private-unselected.txt"), "PRIVATE-DO-NOT-EXPOSE");
    const report = await runPreviewRecoveryDrill(context);
    assert.equal(report.status, "verified-installed-preview", JSON.stringify(report));
    assert.equal(report.sourceUnchanged, true);
    assert.equal(report.temporaryCopiesRemoved, true);
    assert.equal(report.scenario.missingFiles, 1);
    assert.equal(report.scenario.failureDetected, true);
    assert.equal(report.backup.sha256, context.expectedHash);
    assert.equal(report.backup.files, context.archive.files.length);
    assert.ok(report.fileChecks.every(check => check.passed));
    assert.ok(report.httpChecks.every(check => check.passed));
    assert.ok(report.httpChecks.some(check => check.path === "/assets/logo-rtt.jpg" && check.bytes > 0));
    assert.ok(report.httpChecks.some(check => check.path === "/routes.json" && check.status === 404));
    assert.ok(report.httpChecks.some(check => check.path === "/solicitar" && check.status === 503));
    assert.ok(report.restoreAndHttpMs >= report.restoreMs);
    assert.equal(report.commercialAccepted, false);
    assert.equal(report.versionedRecoveryVerified, false);
    assert.ok(!JSON.stringify(report).includes(context.temporary));
    assert.ok(!JSON.stringify(report).includes("PRIVATE-DO-NOT-EXPOSE"));
    assert.equal(await readFile(join(context.sourceDirectory, "private-unselected.txt"), "utf8"), "PRIVATE-DO-NOT-EXPOSE");
    for (const [name, bytes] of verifyPreviewArchive(context.archive))
      assert.deepEqual(await readFile(join(context.sourceDirectory, name)), bytes);
    assert.deepEqual((await readdir(context.sourceDirectory)).filter(name => name !== "private-unselected.txt"), before);
    assert.equal(hash(await readFile(join(context.backupDirectory, context.filename))), context.expectedHash);
  });
});

test("un respaldo anterior no se aplica cuando la vista previa actual ya cambió", async () => {
  await fixture(async context => {
    const path = join(context.sourceDirectory, "index.html");
    await writeFile(path, "CURRENT-BYTES-DO-NOT-ROLL-BACK");
    const report = await runPreviewRecoveryDrill(context);
    assert.equal(report.status, "not-completed");
    assert.equal(report.stage, "source-review");
    assert.equal(report.scenario, undefined);
    assert.equal(await readFile(path, "utf8"), "CURRENT-BYTES-DO-NOT-ROLL-BACK");
  });
});

test("publicación activa o guarda/evidencia inválida exige revisión y se conserva", async () => {
  await fixture(async context => {
    for (const [name, value] of [["current-release.json", "{}"], ["publish.lock", "PRIVATE-BAD-OWNER"], [`abort-continuation-finalization-${randomUUID()}.intent.json`, "PRIVATE-BAD-INTENT"]]) {
      const path = join(context.sourceDirectory, name);
      await writeFile(path, value, { flag: "wx" });
      const report = await runPreviewRecoveryDrill(context);
      assert.equal(report.status, "not-completed");
      assert.equal(report.stage, "source-review");
      assert.equal(report.scenario, undefined);
      assert.equal(await readFile(path, "utf8"), value);
      assert.ok(!JSON.stringify(report).includes("PRIVATE-BAD"));
      await rm(path); // Solo archivos que este fixture creó dentro de su directorio.
    }
  });
});

test("hash incorrecto, traversal y contenido manipulado fallan antes del simulacro", async () => {
  await fixture(async context => {
    for (const changes of [{ expectedHash: "a".repeat(64) }, { filename: "../" + context.filename }, { expectedHash: "PRIVATE-INVALID-HASH" }]) {
      const report = await runPreviewRecoveryDrill({ ...context, ...changes });
      assert.equal(report.status, "not-completed");
      assert.equal(report.stage, "backup-selection");
      assert.equal(report.backup, undefined);
      assert.ok(!JSON.stringify(report).includes("PRIVATE-INVALID"));
    }
    const altered = structuredClone(context.archive);
    altered.files[0].data = Buffer.from("CORRUPTED").toString("base64");
    const raw = JSON.stringify(altered);
    await writeFile(join(context.backupDirectory, context.filename), raw);
    const report = await runPreviewRecoveryDrill({ ...context, expectedHash: hash(raw) });
    assert.equal(report.status, "not-completed");
    assert.equal(report.stage, "backup-selection");
    assert.equal(report.scenario, undefined);
  });
});

test("nombres de ruta que cambiarían el origen HTTP se rechazan antes de abrir el servidor", async () => {
  await fixture(async context => {
    for (const invalidRoute of ["//example.invalid/", "/\\example.invalid/", "/../", "/?private=value", "/#fragment"]) {
      const altered = structuredClone(context.archive);
      const entry = altered.files.find(file => file.name === "routes.json");
      const routes = JSON.parse(Buffer.from(entry.data, "base64"));
      routes[invalidRoute] = routes["/"];
      const bytes = Buffer.from(JSON.stringify(routes));
      entry.data = bytes.toString("base64");
      entry.sha256 = hash(bytes);
      const raw = JSON.stringify(altered);
      await writeFile(join(context.backupDirectory, context.filename), raw);
      const report = await runPreviewRecoveryDrill({ ...context, expectedHash: hash(raw) });
      assert.equal(report.status, "not-completed");
      assert.equal(report.stage, "backup-selection");
      assert.equal(report.httpChecks, undefined);
      assert.equal(report.scenario, undefined);
    }
  });
});

test("no inspecciona como instalación una unión de directorio a otra ubicación", async () => {
  await fixture(async context => {
    const link = join(context.temporary, "linked-source");
    await symlink(resolve(context.sourceDirectory), link, process.platform === "win32" ? "junction" : "dir");
    const report = await runPreviewRecoveryDrill({ ...context, sourceDirectory: link });
    assert.equal(report.status, "not-completed");
    assert.equal(report.stage, "source-review");
    assert.equal(report.scenario, undefined);
  });
});

test("lector compartido limita tamaño y rechaza archivos no regulares", async () => {
  await fixture(async context => {
    const { archive, archiveBytes } = await loadSavedBackup(context.backupDirectory, context.filename, context.expectedHash);
    assert.deepEqual(archive, context.archive);
    assert.equal(archiveBytes, (await readFile(join(context.backupDirectory, context.filename))).length);
    const path = join(context.backupDirectory, context.filename);
    await writeFile(path, Buffer.alloc(22000001));
    await assert.rejects(loadSavedBackup(context.backupDirectory, context.filename, "a".repeat(64)), /demasiado grande/);
    await rm(path);
    await mkdir(path);
    await assert.rejects(loadSavedBackup(context.backupDirectory, context.filename, "a".repeat(64)), /no regular/);
  });
});

test("campos no verificados del archivo no filtran contenido privado al reporte", async () => {
  await fixture(async context => {
    const altered = { ...context.archive, generatedAt: "PRIVATE-DATA-NOT-A-DATE" };
    const raw = JSON.stringify(altered);
    await writeFile(join(context.backupDirectory, context.filename), raw);
    const report = await runPreviewRecoveryDrill({ ...context, expectedHash: hash(raw) });
    assert.equal(report.status, "verified-installed-preview");
    assert.equal(report.backup.generatedAt, null);
    assert.ok(!JSON.stringify(report).includes("PRIVATE-DATA"));
  });
});

test("cambio concurrente en fuente o respaldo impide confirmar éxito y no se revierte", async () => {
  for (const selected of ["source", "backup"]) await fixture(async context => {
    const fetchHttp = globalThis.fetch;
    let changed = false;
    const target = selected === "source" ? join(context.sourceDirectory, "index.html") : join(context.backupDirectory, context.filename);
    try {
      globalThis.fetch = async (...args) => {
        if (!changed) {
          changed = true;
          await writeFile(target, "CONCURRENT-CHANGE-MUST-BE-PRESERVED");
        }
        return fetchHttp(...args);
      };
      const report = await runPreviewRecoveryDrill(context);
      assert.equal(report.status, "not-completed");
      assert.equal(report.stage, "source-and-backup-recheck");
      assert.equal(report.sourceUnchanged, false);
      assert.equal(report.temporaryCopiesRemoved, true);
      assert.ok(report.httpChecks.every(check => check.passed));
      assert.equal(await readFile(target, "utf8"), "CONCURRENT-CHANGE-MUST-BE-PRESERVED");
    } finally { globalThis.fetch = fetchHttp; }
  });
});

test("HTTP incorrecto nunca produce éxito ni conserva cuerpos privados en el reporte", async () => {
  await fixture(async context => {
    const fetchHttp = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => new URL(url).pathname === "/routes.json"
        ? new Response("PRIVATE-BODY-MUST-NOT-ENTER-REPORT", { status: 200 }) : fetchHttp(url, options);
      const report = await runPreviewRecoveryDrill(context);
      assert.equal(report.status, "not-completed");
      assert.equal(report.stage, "restored-http");
      assert.equal(report.temporaryCopiesRemoved, true);
      assert.ok(report.httpChecks.some(check => !check.passed && check.path === "/routes.json"));
      assert.ok(!JSON.stringify(report).includes("PRIVATE-BODY"));
    } finally { globalThis.fetch = fetchHttp; }
  });
});
