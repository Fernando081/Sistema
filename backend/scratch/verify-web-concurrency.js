require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('../db-config');
const {
  WebCatalogService,
} = require('../dist/web-catalog/web-catalog.service');
const { readSnapshot } = require('../dist/common/database/typed-query');
const {
  exportWebCandidate,
} = require('../dist/web-catalog/web-catalog-export');
async function main() {
  assert.equal(process.versions.node.split('.')[0], '24');
  const schema = 'web_concurrency_verify_' + randomBytes(8).toString('hex');
  const config = databaseConfig();
  const source = new DataSource({
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
    database: config.database,
    schema,
    synchronize: false,
    logging: false,
    extra: {
      options: `-c search_path=${schema} -c statement_timeout=10000`,
      max: 6,
      application_name: schema,
    },
  });
  await source.initialize();
  let created = false;
  try {
    await source.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await source.transaction(async (manager) => {
      await manager.query(
        'CREATE TABLE auth_user(id_user int PRIMARY KEY); CREATE TABLE producto("IdProducto" int PRIMARY KEY); INSERT INTO auth_user VALUES(1); INSERT INTO producto VALUES(1),(2)',
      );
      await manager.query(
        readFileSync(
          join(__dirname, '../migrations/088_preparacion_catalogo_web.sql'),
          'utf8',
        ),
      );
      await manager.query(
        'CREATE TABLE auditoria_jsonb(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,table_name text,action text,new_record jsonb,app_user_id integer REFERENCES auth_user(id_user),timestamp timestamptz DEFAULT CURRENT_TIMESTAMP)',
      );
      const snapshot = {
        codigo: 'TEST',
        marca: 'Fixture',
        categoria: 'Fixture',
        titulo: 'Fixture',
        descripcion: 'Solo prueba aislada',
        aplicaciones: [],
        numerosParte: [],
        especificaciones: [],
      };
      await manager.query(
        "INSERT INTO web_producto_ficha(id_producto,slug,titulo,descripcion,estado,datos_reales_confirmados,derechos_imagen_confirmados,compatibilidad_verificada,snapshot,updated_by) VALUES(1,'fixture','Fixture','Solo prueba','listo',true,true,true,$1::jsonb,1)",
        [JSON.stringify(snapshot)],
      );
    });
    await readSnapshot(source, async (manager) => {
      assert.equal(
        (await manager.query('SHOW transaction_isolation'))[0]
          .transaction_isolation,
        'repeatable read',
      );
      assert.equal(
        (await manager.query('SHOW transaction_read_only'))[0]
          .transaction_read_only,
        'on',
      );
      const first = await manager.query(
        'SELECT version FROM web_producto_ficha WHERE id_producto=1',
      );
      await source.query(
        'UPDATE web_producto_ficha SET version=2 WHERE id_producto=1',
      );
      assert.equal(
        (
          await manager.query(
            'SELECT version FROM web_producto_ficha WHERE id_producto=1',
          )
        )[0].version,
        first[0].version,
      );
    });
    assert.equal(
      (
        await source.query(
          'SELECT version FROM web_producto_ficha WHERE id_producto=1',
        )
      )[0].version,
      2,
    );
    await assert.rejects(
      readSnapshot(source, (manager) =>
        manager.query(
          'UPDATE web_producto_ficha SET version=3 WHERE id_producto=1',
        ),
      ),
      (error) => error.code === '25006',
    );
    const service = new WebCatalogService(source);
    const approval = await service.approveCandidate(1, 2, true, 1);
    assert.equal(
      (await service.approvalStatus(1, approval.receipt.id)).active,
      true,
    );
    await Promise.all([
      service.revokeApproval(1, approval.receipt.id, true, 1),
      service.revokeApproval(1, approval.receipt.id, true, 1),
    ]);
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM auditoria_jsonb WHERE action='REVOKE'",
        )
      )[0].n,
      1,
    );
    const profile = (
      await source.query(
        'SELECT snapshot FROM web_producto_ficha WHERE id_producto=1',
      )
    )[0];
    const product = {
      ...exportWebCandidate('fixture', profile.snapshot).products[0],
      status: 'published',
      approved: true,
    };
    const raw = JSON.stringify({ schemaVersion: 1, products: [product] });
    const batch = await service.approveBatch(
      raw,
      [{ productId: 1, version: 2 }],
      true,
      1,
    );
    await Promise.all([
      service.revokeBatch(batch.receipt.id, true, 1),
      service.revokeBatch(batch.receipt.id, true, 1),
    ]);
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM auditoria_jsonb WHERE action='REVOKE' AND table_name='web_catalog_batch_approval'",
        )
      )[0].n,
      1,
    );
    const blocker = source.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    let pending;
    try {
      await blocker.query(
        'SELECT id_producto FROM web_producto_ficha WHERE id_producto=1 FOR UPDATE',
      );
      pending = service
        .approveBatch(raw, [{ productId: 1, version: 2 }], true, 1)
        .then(
          () => ({ ok: true }),
          (error) => ({ error }),
        );
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        waiting = (
          await source.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') waiting",
            [schema],
          )
        )[0].waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        waiting,
        true,
        'Aprobación debe esperar el bloqueo de edición',
      );
      await blocker.query(
        'UPDATE web_producto_ficha SET version=3 WHERE id_producto=1',
      );
      await blocker.commitTransaction();
      const result = await pending;
      assert.equal(result.error?.getStatus(), 409);
      assert.equal((await service.batchStatus(batch.receipt.id)).active, false);
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      if (pending) await pending;
      await blocker.release();
    }
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM auditoria_jsonb WHERE table_name='web_catalog_batch_approval' AND action='APPROVE'",
        )
      )[0].n,
      1,
    );
    console.log(
      'TypeORM real: snapshot READ ONLY/REPEATABLE READ, revocaciones concurrentes idempotentes y conflicto tras edición bloqueada aprobados.',
    );
  } finally {
    try {
      if (created) {
        if (!/^web_concurrency_verify_[a-f0-9]{16}$/.test(schema))
          throw new Error('Esquema fuera de alcance');
        await source.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal(
          (
            await source.query(
              'SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',
              [schema],
            )
          )[0].n,
          0,
        );
      }
    } finally {
      await source.destroy();
    }
  }
}
main().catch(() => {
  console.error(
    'Falló prueba aislada de concurrencia; no se imprimen credenciales.',
  );
  process.exitCode = 1;
});
