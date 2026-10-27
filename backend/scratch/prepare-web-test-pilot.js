const { Client } = require('pg');
const { chromium } = require('@playwright/test');
const { databaseConfig } = require('../db-config');
const { mkdir, writeFile, readFile, lstat, realpath, rename } = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const { resolve, join, sep } = require('node:path');
const workspace = resolve(__dirname, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceQuery = `SELECT p."IdProducto" id,p."Codigo" codigo,p."Descripcion" nombre,p."Marca" marca,c."Descripcion" categoria,p.imagenes,
  coalesce((SELECT jsonb_agg(jsonb_build_object('tipo',tipo,'fabricante',fabricante,'numero',numero) ORDER BY id_numero)
    FROM public.producto_numero_parte WHERE id_producto=p."IdProducto"),'[]'::jsonb) AS "numerosParte",
  coalesce((SELECT jsonb_agg(jsonb_build_object('fabricante',fabricante_equipo,'modelo',modelo,'motor',motor,'desde',anio_desde,'hasta',anio_hasta,'restricciones',restricciones) ORDER BY id_aplicacion)
    FROM public.producto_aplicacion WHERE id_producto=p."IdProducto"),'[]'::jsonb) AS aplicaciones
  FROM public.producto p LEFT JOIN public.categoria c ON c."IdCategoria"=p."IdCategoria"
  WHERE nullif(trim(p."Codigo"),'') IS NOT NULL AND nullif(trim(p."Marca"),'') IS NOT NULL
  ORDER BY CASE WHEN jsonb_typeof(p.imagenes)='array' THEN jsonb_array_length(p.imagenes) ELSE 0 END DESC,p."IdProducto" LIMIT 80`;
async function sourceSnapshot() {
  const config = databaseConfig();
  const hostname = config.connectionString ? new URL(config.connectionString).hostname : config.host;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) throw new Error('Sólo se admite BD local');
  const client = new Client({ ...config, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    if ((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw new Error('Lectura no protegida');
    return (await client.query(sourceQuery)).rows;
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
}
async function sourceImage(base, name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(name)) throw new Error('Nombre de imagen inválido');
  const path = join(base, name), entry = await lstat(path), physical = await realpath(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 8000000 || !physical.startsWith(base + sep)) throw new Error('Imagen no regular');
  const bytes = await readFile(physical);
  if (bytes.length > 8000000) throw new Error('Imagen demasiado grande');
  const png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw new Error('Formato no admitido por este piloto');
  return { name, bytes, mime: png ? 'image/png' : 'image/jpeg', sha256: hash(bytes) };
}
async function prepareImages(page, images, product, destination) {
  const selected = [];
  const sources = [];
  const base = await realpath(join(workspace, 'backend/uploads'));
  for (const item of Array.isArray(images) ? images : []) {
    if (typeof item !== 'string') continue;
    let source;
    try { source = await sourceImage(base, item.replace(/^\/uploads\//, '')); } catch { continue; }
    const converted = await page.evaluate(async ({ data, mime }) => {
      const image = new Image(); image.src = `data:${mime};base64,${data}`;
      await image.decode();
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('Dimensiones excesivas');
      const encode = width => {
        width = Math.min(width, image.naturalWidth);
        const canvas = document.createElement('canvas'); canvas.width = width;
        canvas.height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
        const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, data: canvas.toDataURL('image/png').split(',')[1] };
      };
      const candidates = [...new Set([Math.min(640, image.naturalWidth), 512, 384, 320, 256, 192, 128].filter(width => width <= image.naturalWidth))].sort((a,b) => b-a);
      const original = candidates.map(encode).find(value => Math.ceil(value.data.length * 3 / 4) <= 250000);
      if (!original) throw new Error('No cumple presupuesto');
      const variant = original.width > 320 ? encode(320) : null;
      return { original, variant: variant && Math.ceil(variant.data.length * 3 / 4) <= 250000 ? variant : null };
    }, { data: source.bytes.toString('base64'), mime: source.mime });
    const persist = async value => {
      const bytes = Buffer.from(value.data, 'base64'), digest = hash(bytes);
      const file = `pilot-${product.id}-${value.width}-${digest.slice(0, 16)}.png`;
      await writeFile(join(destination, file), bytes, { flag: 'wx' });
      return { file, sha256: digest, width: value.width, height: value.height, alt: `${product.nombre} · Imagen de la BD de prueba`, authorized: true };
    };
    const image = await persist(converted.original);
    if (converted.variant) image.variants = [await persist(converted.variant)];
    selected.push(image); sources.push({ name: source.name, sha256: source.sha256, bytes: source.bytes.length });
    break; // Una fotografía disponible por pieza; sin reemplazar originales.
  }
  return { selected, sources };
}
(async () => {
  const args = process.argv.slice(2);
  const limit = args.length ? Number(args[0].replace(/^--limit=/, '')) : 10;
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'not-completed', stage: 'arguments',
    sourceKind: 'test-database', commercialAccepted: false, erpApprovalRecorded: false,
    scope: 'Piloto técnico local con lectura PostgreSQL y copias de medios; no aprobación comercial, publicación externa o modificación del ERP.' };
  let browser;
  try {
    await mkdir(join(workspace, '.artifacts'), { recursive: true });
    await writeFile(join(workspace, '.artifacts/web-test-pilot.json'), JSON.stringify(report, null, 2));
    if (Number(process.versions.node.split('.')[0]) !== 24 || args.length > 1 || (args.length && !/^--limit=(?:[5-9]|10)$/.test(args[0])) || limit < 5 || limit > 10)
      throw new Error('Usa Node24 y límite 5–10');
    const { testPilotProduct } = await import('../../public-web/test-pilot-model.mjs');
    const { validateCatalog } = await import('../../public-web/catalog.mjs');
    const { publishCatalog, rollbackRelease } = await import('../../public-web/publish.mjs');
    const { importMedia } = await import('../../public-web/import-media.mjs');
    const { backupTestPilot, rehearseTestPilot } = await import('../../public-web/test-pilot-backup.mjs');
    const { inspectActiveRelease } = await import('../../public-web/active-release.mjs');
    const { backupPreview } = await import('../../public-web/preview-backup.mjs');
    const publicFingerprint = async () => (await backupPreview(join(workspace, 'public-web/dist'))).files.map(file => [file.name, file.sha256]);
    report.stage = 'read-only-source';
    const rows = await sourceSnapshot();
    const eligible = [];
    for (const row of rows) {
      try { eligible.push({ row, product: testPilotProduct(row) }); } catch { /* Campo público incompleto: no inventarlo. */ }
      if (eligible.length === limit) break;
    }
    if (eligible.length < 5) throw new Error('No hay cinco piezas elegibles');
    const before = await publicFingerprint();
    const runId = randomUUID(), runtime = join(workspace, '.runtime');
    await mkdir(runtime, { recursive: true });
    if ((await lstat(runtime)).isSymbolicLink() || !(await realpath(runtime)).startsWith((await realpath(workspace)) + sep)) throw new Error('Runtime fuera del proyecto');
    const run = join(runtime, `web-test-pilot-${runId}`), mediaSource = join(run, 'source-media'), media = join(run, 'media'), site = join(run, 'site');
    await mkdir(run); await mkdir(mediaSource); await mkdir(media);
    report.runId = runId; report.stage = 'copy-and-prepare-media';
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); await page.goto('about:blank');
    const selection = [];
    for (const entry of eligible) {
      const prepared = await prepareImages(page, entry.row.imagenes, entry.row, mediaSource);
      if (prepared.selected.length) entry.product.images = prepared.selected;
      selection.push({ productId: entry.row.id, code: entry.product.code, slug: entry.product.slug,
        images: prepared.selected.length, sources: prepared.sources, needsCommercialReview: true });
    }
    await browser.close(); browser = undefined;
    const products = validateCatalog({ schemaVersion: 1, products: eligible.map(entry => entry.product) });
    const raw = JSON.stringify({ schemaVersion: 1, products }, null, 2);
    await writeFile(join(run, 'catalog-test.json'), raw, { flag: 'wx' });
    report.media = await importMedia(raw, mediaSource, media);
    report.stage = 'sealed-test-versions';
    const approve = value => ({ sha256: hash(value), reviewer: 'Piloto técnico autorizado con BD de prueba', decision: 'approve-local-preview' });
    const options = { mediaDirectory: media, previewMode: 'test-db-pilot' };
    const first = await publishCatalog(raw, approve(raw), site, options);
    const withdrawnRaw = JSON.stringify({ schemaVersion: 1, products: products.slice(0, -1) }, null, 2);
    const second = await publishCatalog(withdrawnRaw, approve(withdrawnRaw), site, options);
    report.stage = 'saved-versioned-backup-and-recovery';
    const archive = await backupTestPilot(site, [first, second]);
    const backupRaw = JSON.stringify(archive), filename = `web-test-pilot-${runId}.json`, sha256 = hash(backupRaw);
    await mkdir(join(workspace, '.backups'), { recursive: true });
    await writeFile(join(workspace, '.backups', filename), backupRaw, { flag: 'wx' });
    report.backup = { filename, sha256, bytes: Buffer.byteLength(backupRaw) };
    report.recovery = await rehearseTestPilot(join(workspace, '.backups'), filename, sha256, first);
    const integrity = hash(await readFile(join(site, 'releases', first, 'integrity.json')));
    await rollbackRelease(first, { decision: 'approve-local-rollback', reviewer: 'Ensayo de piloto técnico autorizado', integrity }, site);
    report.active = await inspectActiveRelease(site);
    report.stage = 'source-recheck';
    const afterRows = await sourceSnapshot();
    report.sourceUnchanged = eligible.every(entry => JSON.stringify(entry.row) === JSON.stringify(afterRows.find(row => row.id === entry.row.id)));
    const uploads = await realpath(join(workspace, 'backend/uploads'));
    for (const entry of selection) for (const source of entry.sources)
      if ((await sourceImage(uploads, source.name)).sha256 !== source.sha256) report.sourceUnchanged = false;
    report.publicPreviewUnchanged = JSON.stringify(before) === JSON.stringify(await publicFingerprint());
    if (!report.sourceUnchanged || !report.publicPreviewUnchanged) throw new Error('Fuente cambió durante preparación');
    report.productCount = products.length; report.withImages = selection.filter(entry => entry.images).length;
    report.selection = selection; report.versions = [first, second]; report.manifestSha256 = hash(raw);
    report.status = 'prepared-test-pilot'; report.stage = 'completed';
    await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    const pointer = { schemaVersion: 1, kind: 'test-db-pilot', runId, manifestSha256: report.manifestSha256, productCount: products.length };
    const pending = join(runtime, `pilot-pointer-${runId}.json`);
    await writeFile(pending, JSON.stringify(pointer), { flag: 'wx' });
    await rename(pending, join(runtime, 'web-test-pilot-current.json'));
  } catch {
    report.status = 'not-completed'; process.exitCode = 1;
  } finally {
    await browser?.close();
    await writeFile(join(workspace, '.artifacts/web-test-pilot.json'), JSON.stringify(report, null, 2));
    console.log(`Piloto de BD de prueba: ${report.status}; etapa ${report.stage}. Reporte .artifacts/web-test-pilot.json`);
  }
})();
