require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { DataSource } = require('typeorm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { databaseConfig } = require('../db-config');
const {
  WebCatalogService,
} = require('../dist/web-catalog/web-catalog.service');
async function verifyLocalHttp(writer, reader, raw, query, repository) {
  const { Test } = require('@nestjs/testing');
  const { APP_GUARD } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const {
    WebCatalogController,
  } = require('../dist/web-catalog/web-catalog.controller');
  const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
  const { RolesGuard } = require('../dist/auth/roles.guard');
  const { AuthService } = require('../dist/auth/auth.service');
  const { AuthController } = require('../dist/auth/auth.controller');
  const { verifyErpReceipt } = await import('../../public-web/erp-receipt.mjs');
  const { publishCatalog, rollbackRelease, digest } =
    await import('../../public-web/publish.mjs');
  const { createPreviewServer } = await import('../../public-web/server.mjs');
  const { importMedia } = await import('../../public-web/import-media.mjs');
  const { chunk } = await import('../../public-web/optimize-png.mjs');
  const { deflateSync } = require('node:zlib');
  const {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
  } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { resolve, sep, basename } = require('node:path');
  let temporary, preview;
  const password = randomBytes(32).toString('hex');
  await query('UPDATE auth_user SET password_hash=$1', [
    await AuthService.hashPassword(password),
  ]);
  const previous = {
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  let auth;
  try {
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.NODE_ENV = 'test';
    auth = new AuthService(repository);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  let token, operator;
  const module = await Test.createTestingModule({
    controllers: [WebCatalogController, AuthController],
    providers: [
      {
        provide: WebCatalogService,
        useValue: {
          approveBatch: writer.approveBatch.bind(writer),
          batchStatus: reader.batchStatus.bind(reader),
          revokeBatch: writer.revokeBatch.bind(writer),
        },
      },
      {
        provide: AuthService,
        useValue: auth,
      },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  try {
    temporary = await mkdtemp(join(tmpdir(), 'rtt-integrated-'));
    const source = join(temporary, 'source'),
      mediaDirectory = join(temporary, 'approved'),
      output = join(temporary, 'site');
    await mkdir(source);
    await mkdir(mediaDirectory);
    const png = (width) => {
      const header = Buffer.alloc(13);
      header.writeUInt32BE(width);
      header.writeUInt32BE(width, 4);
      header[8] = 8;
      header[9] = 6;
      return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.alloc(width * (1 + 4 * width)))),
        chunk('IEND', Buffer.alloc(0)),
      ]);
    };
    const original = png(2),
      variant = png(1);
    await writeFile(join(source, 'fixture.png'), original);
    await writeFile(join(source, 'small.png'), variant);
    const manifest = JSON.parse(raw);
    manifest.products[0].images = [
      {
        file: 'fixture.png',
        sha256: digest(original),
        width: 2,
        height: 2,
        alt: 'Fixture aislada',
        authorized: true,
        variants: [
          {
            file: 'small.png',
            sha256: digest(variant),
            width: 1,
            height: 1,
            alt: 'Fixture aislada',
            authorized: true,
          },
        ],
      },
    ];
    raw = JSON.stringify(manifest);
    await app.listen(0, '127.0.0.1');
    const baseUrl = `${await app.getUrl()}/api/v1/`;
    const login = async (username, secret) =>
      fetch(new URL('auth/login', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: secret }),
      });
    assert.equal(
      (await login('fixture-admin', password + 'incorrecta')).status,
      401,
    );
    const adminLogin = await login('fixture-admin', password);
    assert.equal(adminLogin.status, 201);
    token = (await adminLogin.json()).access_token;
    const operatorLogin = await login('fixture-user', password);
    assert.equal(operatorLogin.status, 201);
    operator = (await operatorLogin.json()).access_token;
    const approve = new URL(
      'web-catalog/admin/products/batch/approve',
      baseUrl,
    );
    const body = {
      raw,
      members: [{ productId: 1, version: 2 }],
      confirmed: true,
    };
    const post = (url, value, session = token) =>
      fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(value),
      });
    assert.equal(
      (
        await fetch(approve, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
      401,
    );
    assert.equal((await post(approve, body, operator)).status, 403);
    assert.equal(
      (await post(approve, { ...body, confirmed: 'true' })).status,
      400,
    );
    const response = await post(approve, body);
    assert.equal(response.status, 201);
    const approval = await response.json();
    const receipt = { scope: 'batch', receiptId: approval.receipt.id };
    const options = { baseUrl, token };
    assert.equal(
      (await verifyErpReceipt(raw, receipt, options)).sha256,
      approval.sha256,
    );
    const tokenParts = token.split('.');
    tokenParts[2] =
      (tokenParts[2][0] === 'a' ? 'b' : 'a') + tokenParts[2].slice(1);
    await assert.rejects(
      verifyErpReceipt(raw, receipt, {
        ...options,
        token: tokenParts.join('.'),
      }),
      /no confirmó/,
    );
    await query('UPDATE auth_user SET is_active=false WHERE id_user=1');
    await assert.rejects(
      verifyErpReceipt(raw, receipt, options),
      /no confirmó/,
    );
    assert.equal((await login('fixture-admin', password)).status, 401);
    await query('UPDATE auth_user SET is_active=true WHERE id_user=1');
    await assert.rejects(
      verifyErpReceipt(raw + ' ', receipt, options),
      /no vigente/,
    );
    assert.equal((await importMedia(raw, source, mediaDirectory)).copied, 2);
    const localApproval = {
      sha256: digest(raw),
      reviewer: 'Arnes aislado',
      decision: 'approve-local-preview',
      erpReceipt: receipt,
    };
    const publishing = { mediaDirectory, erp: options };
    const release = await publishCatalog(
      raw,
      localApproval,
      output,
      publishing,
    );
    preview = await createPreviewServer(output);
    await new Promise((resolve) => preview.listen(0, '127.0.0.1', resolve));
    const publicBase = `http://127.0.0.1:${preview.address().port}`;
    const html = await fetch(publicBase + '/productos/fixture');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /srcset=/);
    for (const bytes of [original, variant]) {
      const response = await fetch(`${publicBase}/media/${digest(bytes)}.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const recorded = await readFile(
      join(output, 'releases', release, 'approval.json'),
      'utf8',
    );
    assert.equal(recorded.includes(token), false);
    assert.equal(
      JSON.parse(recorded).verifiedReceipt.receiptId,
      receipt.receiptId,
    );
    const rollbackApproval = {
      integrity: digest(
        await readFile(
          join(output, 'releases', release, 'integrity.json'),
          'utf8',
        ),
      ),
      reviewer: 'Arnes aislado',
      decision: 'approve-local-rollback',
    };
    const replacement = await publishCatalog(
      raw,
      localApproval,
      output,
      publishing,
    );
    assert.notEqual(replacement, release);
    await rollbackRelease(release, rollbackApproval, output, publishing);
    assert.equal(
      JSON.parse(await readFile(join(output, 'current-release.json'), 'utf8'))
        .release,
      release,
    );
    const pointer = await readFile(
      join(output, 'current-release.json'),
      'utf8',
    );
    await writeFile(join(mediaDirectory, 'small.png'), 'alterado');
    await assert.rejects(
      publishCatalog(raw, localApproval, output, publishing),
      /Imagen inválida/,
    );
    assert.equal(
      await readFile(join(output, 'current-release.json'), 'utf8'),
      pointer,
    );
    await writeFile(join(mediaDirectory, 'small.png'), variant);
    const revoke = new URL(
      `web-catalog/admin/products/batch/approvals/${receipt.receiptId}/revoke`,
      baseUrl,
    );
    assert.equal((await post(revoke, { confirmed: true })).status, 201);
    assert.equal((await post(revoke, { confirmed: true })).status, 201);
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='web_catalog_batch_approval' AND action='REVOKE' AND new_record->>'receiptId'=$1",
          [String(receipt.receiptId)],
        )
      )[0].n,
      1,
    );
    await assert.rejects(verifyErpReceipt(raw, receipt, options), /no vigente/);
    await assert.rejects(
      rollbackRelease(release, rollbackApproval, output, publishing),
      /no vigente/,
    );
    assert.equal(
      await readFile(join(output, 'current-release.json'), 'utf8'),
      pointer,
    );
    await assert.rejects(
      publishCatalog(raw, localApproval, output, publishing),
      /no vigente/,
    );
    assert.equal(
      await readFile(join(output, 'current-release.json'), 'utf8'),
      pointer,
    );
    const logout = await post(new URL('auth/logout-all', baseUrl), {});
    assert.equal(logout.status, 201);
    await assert.rejects(
      verifyErpReceipt(raw, receipt, options),
      /no confirmó/,
    );
    assert.equal(
      (await query('SELECT token_version FROM auth_user WHERE id_user=1'))[0]
        .token_version,
      1,
    );
  } finally {
    if (preview) await new Promise((resolve) => preview.close(resolve));
    await app.close();
    if (temporary) {
      const target = resolve(temporary);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !basename(target).startsWith('rtt-integrated-')
      )
        throw new Error('Temporal fuera de alcance');
      await rm(target, { recursive: true, force: true });
    }
  }
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const schema = 'web_approval_verify_' + randomBytes(8).toString('hex');
  const config = databaseConfig();
  const { AuthUser } = require('../dist/auth/auth-user.entity');
  const connection = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
    database: config.database,
    schema,
    entities: [AuthUser],
    synchronize: false,
    logging: false,
  });
  await connection.initialize();
  const runner = connection.createQueryRunner();
  await runner.connect();
  const client = {
    query: async (sql, args) => ({ rows: await runner.query(sql, args) }),
    end: async () => {
      await runner.release();
      await connection.destroy();
    },
  };
  try {
    await runner.startTransaction();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      `CREATE TABLE auth_user(id_user int PRIMARY KEY,username text UNIQUE,password_hash text,role text,is_active boolean DEFAULT true,token_version int DEFAULT 0); CREATE TABLE producto("IdProducto" int PRIMARY KEY); INSERT INTO auth_user(id_user,username,role) VALUES(1,'fixture-admin','admin'),(2,'fixture-user','user'); INSERT INTO producto VALUES(1),(2);`,
    );
    await client.query(readFileSync(join(__dirname,'../migrations/095_sesiones_por_navegador.sql'),'utf8'));
    await client.query(readFileSync(join(__dirname,'../migrations/096_autenticacion_dos_pasos.sql'),'utf8'));
    await client.query(
      readFileSync(
        join(__dirname, '../migrations/088_preparacion_catalogo_web.sql'),
        'utf8',
      ),
    );
    await client.query(
      `CREATE TABLE auditoria_jsonb(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,table_name varchar(100) NOT NULL,action varchar(20) NOT NULL,new_record jsonb,app_user_id integer REFERENCES auth_user(id_user),timestamp timestamptz DEFAULT CURRENT_TIMESTAMP);`,
    );
    const snapshot = {
      codigo: 'TEST',
      marca: 'Fixture',
      categoria: 'Fixture',
      titulo: 'Fixture temporal',
      descripcion: 'Solo prueba SQL aislada',
      aplicaciones: [],
      numerosParte: [],
      especificaciones: [],
      costo: 999,
      VIN: 'privado',
    };
    await client.query(
      `INSERT INTO web_producto_ficha(id_producto,slug,titulo,descripcion,estado,datos_reales_confirmados,derechos_imagen_confirmados,compatibilidad_verificada,snapshot,updated_by) VALUES(1,'fixture','Fixture temporal','Solo prueba','listo',true,true,true,$1::jsonb,1)`,
      [JSON.stringify(snapshot)],
    );
    const query = async (sql, args) => (await client.query(sql, args)).rows;
    const source = {
      query,
      transaction: async (work) => {
        await client.query('SAVEPOINT approval_work');
        try {
          const result = await work({ query });
          await client.query('RELEASE SAVEPOINT approval_work');
          return result;
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT approval_work');
          await client.query('RELEASE SAVEPOINT approval_work');
          throw error;
        }
      },
    };
    const writer = new WebCatalogService(source);
    const reader = new WebCatalogService({ query });
    const approval = await writer.approveCandidate(1, 1, true, 1);
    assert.equal(
      (await reader.approvalStatus(1, approval.receipt.id)).active,
      true,
    );
    assert.doesNotMatch(approval.raw, /costo|VIN|privado/);
    await client.query(
      'UPDATE web_producto_ficha SET snapshot=$1::jsonb WHERE id_producto=1',
      [
        JSON.stringify({
          ...snapshot,
          titulo: 'Contenido cambiado sin versión',
        }),
      ],
    );
    assert.equal(
      (await reader.approvalStatus(1, approval.receipt.id)).active,
      false,
    );
    await client.query(
      'UPDATE web_producto_ficha SET snapshot=$1::jsonb WHERE id_producto=1',
      [JSON.stringify(snapshot)],
    );
    await assert.rejects(writer.approveCandidate(1, 1, true, 999));
    await assert.rejects(
      reader.approvalStatus(2, approval.receipt.id),
      /Recibo no encontrado/,
    );
    await client.query(
      'UPDATE web_producto_ficha SET version=2 WHERE id_producto=1',
    );
    assert.equal(
      (await reader.approvalStatus(1, approval.receipt.id)).active,
      false,
    );
    await assert.rejects(writer.approveCandidate(1, 1, true, 1), /cambió/);
    const second = await writer.approveCandidate(1, 2, true, 1);
    await writer.revokeApproval(1, second.receipt.id, true, 1);
    await writer.revokeApproval(1, second.receipt.id, true, 1);
    const status = await reader.approvalStatus(1, second.receipt.id);
    assert.equal(status.active, false);
    assert.equal(status.revoked, true);
    const events = await query(
      'SELECT action,app_user_id,new_record FROM auditoria_jsonb ORDER BY id',
    );
    assert.deepEqual(
      events.map((row) => row.action),
      ['APPROVE', 'APPROVE', 'REVOKE'],
    );
    assert.ok(events.every((row) => row.app_user_id === 1));
    assert.doesNotMatch(JSON.stringify(events), /costo|VIN|privado/);
    const {
      exportWebCandidate,
    } = require('../dist/web-catalog/web-catalog-export');
    const publicProduct = {
      ...exportWebCandidate('fixture', snapshot).products[0],
      status: 'published',
      approved: true,
      images: [
        {
          file: 'fixture.png',
          sha256: 'a'.repeat(64),
          width: 1,
          height: 1,
          authorized: true,
          alt: 'Fixture temporal',
        },
      ],
    };
    const batchRaw = JSON.stringify({
      schemaVersion: 1,
      products: [publicProduct],
    });
    const batch = await writer.approveBatch(
      batchRaw,
      [{ productId: 1, version: 2 }],
      true,
      1,
    );
    assert.equal(batch.raw, batchRaw);
    await verifyLocalHttp(
      writer,
      reader,
      batchRaw,
      query,
      runner.manager.getRepository(AuthUser),
    );
    assert.equal((await reader.batchStatus(batch.receipt.id)).active, true);
    await query('UPDATE web_producto_ficha SET version=3 WHERE id_producto=1');
    assert.equal((await reader.batchStatus(batch.receipt.id)).active, false);
    await query('UPDATE web_producto_ficha SET version=2 WHERE id_producto=1');
    assert.equal((await reader.batchStatus(batch.receipt.id)).active, true);
    await writer.revokeBatch(batch.receipt.id, true, 1);
    await writer.revokeBatch(batch.receipt.id, true, 1);
    const batchStatus = await reader.batchStatus(batch.receipt.id);
    assert.equal(batchStatus.active, false);
    assert.equal(batchStatus.revoked, true);
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='web_catalog_batch_approval' AND action='REVOKE' AND new_record->>'receiptId'=$1",
          [String(batch.receipt.id)],
        )
      )[0].n,
      1,
    );
    assert.equal(
      (
        await query('SELECT new_record FROM auditoria_jsonb WHERE id=$1', [
          batch.receipt.id,
        ])
      )[0].new_record.sha256,
      batch.sha256,
    );
    await assert.rejects(
      writer.approveBatch(batchRaw, [{ productId: 1, version: 1 }], true, 1),
      /cambió/,
    );
  } finally {
    try {
      if(runner.isTransactionActive)await runner.rollbackTransaction();
      assert.equal(
        (await client.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',[schema])).rows[0].n,0,
      );
    } finally { await client.end(); }
  }
  console.log(
    'SQL/HTTP/publicación aislados: login bcrypt/JWT/TypeORM reales, firma/usuario/sesión revocados, aprobación, medios, puntero y rollback SQL verificados con credenciales temporales.',
  );
}
main().catch((error) => {
  console.error(
    'Falló verificación SQL aislada; revisar configuración o implementación sin exponer credenciales.',
  );
  console.error(error.name,(error.stack||'').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,3).join('\n'));
  process.exitCode = 1;
});
