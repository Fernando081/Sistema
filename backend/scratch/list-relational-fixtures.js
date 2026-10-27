const assert = require('node:assert/strict');
// Called only after restoration and migration validation in a database owned by the HTTP tool.
async function relationalFixtures(client, databaseName, count = 20000) {
  assert.match(databaseName, /^sistema_http_\d+_[a-f0-9]{6}$/);
  assert.equal(
    (await client.query('SELECT current_database() name')).rows[0].name,
    databaseName,
  );
  await client.query('BEGIN');
  try {
    await client.query(
      "SET LOCAL search_path=public;SET LOCAL statement_timeout='120s'",
    );
    await client.query(
      'TRUNCATE public.cliente,public.proveedor,public.producto,public.categoria,public.factura,public.cotizacion,public.compra CASCADE',
    );
    const catalog = (
      await client.query(`SELECT
      (SELECT min("IdRegimenFiscal") FROM regimenfiscal) regimen,
      (SELECT min("IdObjetoImpuesto") FROM objetoimpuesto) objeto,
      (SELECT min("IdClaveProdOServ") FROM claveproductooservicio) satproducto,
      (SELECT min("IdClaveUnidad") FROM claveunidad) satunidad`)
    ).rows[0];
    for (const id of Object.values(catalog))
      assert.ok(Number.isSafeInteger(id));
    for (const table of ['cliente', 'proveedor']) {
      const key = table === 'cliente' ? 'IdCliente' : 'IdProveedor';
      await client.query(
        `INSERT INTO public.${table}("${key}","RFC","RazonSocial","CodigoPostal","IdRegimenFiscal") OVERRIDING SYSTEM VALUE SELECT "${key}","RFC","RazonSocial"||' '||"${key}"::text,"CodigoPostal",$1 FROM q04_load.${table}`,
        [catalog.regimen],
      );
    }
    await client.query(`INSERT INTO categoria("IdCategoria","Descripcion") OVERRIDING SYSTEM VALUE VALUES(1,'Filtros');
      INSERT INTO compra(id_compra,id_proveedor,folio_factura_proveedor,fecha_compra,total,estatus) OVERRIDING SYSTEM VALUE
 SELECT id_compra,id_compra,folio_factura,fecha_compra,total,estatus FROM q04_load.fixture_compras;
      INSERT INTO cotizacion(id_cotizacion,id_cliente,folio,fecha_emision,nombre_receptor,rfc_receptor,total,estatus) OVERRIDING SYSTEM VALUE
 SELECT id_cotizacion,id_cotizacion,folio,fecha_emision,nombre_receptor,rfc_receptor,total,estatus FROM q04_load.cotizacion;
`);
    for (let start = 1; start <= count; start += 1000) {
      await client.query(
        `INSERT INTO factura(id_factura,id_cliente,serie,folio,fecha_emision,nombre_receptor,rfc_receptor,tipo_comprobante,total,estatus,codigo_postal_receptor,regimen_fiscal_receptor_clave,uso_cfdi_clave) OVERRIDING SYSTEM VALUE
 SELECT id_factura,id_factura,serie,folio,fecha_emision,nombre_receptor,rfc_receptor,tipo_comprobante,total,estatus::public.estatus_factura_enum,'89000','601','G03' FROM q04_load.factura WHERE id_factura BETWEEN $1 AND $2`,
        [start, Math.min(start + 999, count)],
      );
    }
    for (let start = 1; start <= count; start += 1000) {
      await client.query(
        `INSERT INTO producto("IdProducto","Codigo","Descripcion","Marca","IdCategoria","IdObjetoImpuesto","IdClaveProdOServ","IdClaveUnidad","PrecioUnitario","Existencia","Ubicacion","imagenes") OVERRIDING SYSTEM VALUE
 SELECT "IdProducto","Codigo","Descripcion","Marca",1,$1,$2,$3,"PrecioUnitario","Existencia","Ubicacion",'["/uploads/q04-fixture-a.png","/uploads/q04-fixture-b.png"]'::jsonb FROM q04_load.fixture_products WHERE "IdProducto" BETWEEN $4 AND $5`,
        [
          catalog.objeto,
          catalog.satproducto,
          catalog.satunidad,
          start,
          Math.min(start + 999, count),
        ],
      );
    }
    await client.query(
      `INSERT INTO producto_equivalente("IdProducto","IdProductoEquivalente") OVERRIDING SYSTEM VALUE SELECT "IdProducto",CASE WHEN "IdProducto"=${count} THEN 1 ELSE "IdProducto"+1 END FROM producto`,
    );
    await client.query('COMMIT;SET search_path=public');
    for (const table of [
      'cliente',
      'proveedor',
      'producto',
      'factura',
      'cotizacion',
      'compra',
    ]) {
      assert.equal(
        (await client.query(`SELECT count(*)::int total FROM public.${table}`))
          .rows[0].total,
        count,
      );
      await client.query(`ANALYZE public.${table}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
module.exports = { relationalFixtures };
