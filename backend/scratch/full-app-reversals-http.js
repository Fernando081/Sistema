const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function verifyReversalsHttp({
  ds,
  request,
  sale,
  product,
  supplier,
  ordered,
  line,
  form,
  user,
  retries = false,
  documents = false,
  transportProbe = false,
  api,
  headers,
}) {
  const create = async (route, payload, key, changed) => {
    if (!retries) return request(route, payload);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(route, payload)),
    );
    assert.ok(results.every((result) => result[key] === results[0][key]));
    assert.equal(
      (
        await request(route, {
          ...payload,
          requestId: payload.requestId.toUpperCase(),
        })
      )[key],
      results[0][key],
    );
    await request(route, { ...payload, ...changed }, 409);
    return results[0];
  };
  const cash = async () =>
    Math.round(
      Number(
        (
          await ds.query(
            'SELECT caja_chica n FROM saldos ORDER BY id_saldo LIMIT 1',
          )
        )[0].n,
      ) * 100,
    );
  const stock = async () =>
    Number(
      (
        await ds.query(
          'SELECT "Existencia" n FROM producto WHERE "IdProducto"=$1',
          [product.id],
        )
      )[0].n,
    );
  const before = await cash(),
    initialStock = await stock();
  const pue = (
    await ds.query(
      'SELECT "IdMetodoDePago" id FROM metododepago WHERE "Clave"=$1',
      ['PUE'],
    )
  )[0].id;
  const makeSale = (qty, price = 10) => ({
    ...sale,
    requestId: randomUUID(),
    idFormaPago: form,
    idMetodoPago: pue,
    subtotal: Math.round(qty * price * 100) / 100,
    total: Math.round(qty * price * 100) / 100,
    conceptos: [
      {
        ...sale.conceptos[0],
        cantidad: qty,
        valorUnitario: price,
        importe: Math.round(qty * price * 100) / 100,
      },
    ],
  });
  const denied = [
    'ventas.cancelar',
    'compras.facturas',
    'compras.pagar',
    'compras.cancelar',
  ];
  try {
    for (const code of denied)
      await ds.query(
        'INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,$2,false)',
        [user.id_user, code],
      );
    for (const route of [
      'venta/1/cancelar',
      'venta/1/devoluciones',
      'cuentas-proveedor/facturas',
      'cuentas-proveedor/facturas/1/pagos',
      'cuentas-proveedor/pagos/1/revertir',
    ])
      await request(route, {}, 403);
  } finally {
    await ds.query(
      'DELETE FROM app_user_permission WHERE id_user=$1 AND permission_code=ANY($2::text[])',
      [user.id_user, denied],
    );
  }
  for (const route of [
    'venta/1/devoluciones',
    'cuentas-proveedor/facturas',
    'cuentas-proveedor/anticipos',
    'cuentas-proveedor/notas-credito',
    'cuentas-proveedor/facturas/1/pagos',
    'cuentas-proveedor/pagos/1/revertir',
  ]) {
    await request(route, {}, 401, {});
    await request(route, {}, 400);
  }
  const returned = await request('venta', makeSale(3, 3.333333));
  const refund = {
    metodoReembolso: 'Efectivo',
    articulos: [{ idProducto: product.id, cantidad: 1 }],
  };
  for (let i = 0; i < 3; i++)
    await request(`venta/${returned.idFactura}/devoluciones`, refund);
  const refunds = await ds.query(
    'SELECT monto_total FROM devolucion WHERE id_factura=$1 ORDER BY id_devolucion',
    [returned.idFactura],
  );
  assert.deepEqual(
    refunds.map((r) => Math.round(Number(r.monto_total) * 100)),
    [333, 334, 333],
  );
  await request(`venta/${returned.idFactura}/devoluciones`, refund, 400);
  assert.equal(await stock(), initialStock);
  assert.equal(await cash(), before);
  const original = await request('venta', makeSale(2));
  const noteDto = {
    ...makeSale(1),
    tipoComprobante: 'E',
    serie: 'NC',
    idFacturaOrigen: original.idFactura,
    metodoReembolso: 'Efectivo',
    cfdisRelacionados: [
      {
        tipoRelacion: '01',
        uuidRelacionado: '00000000-0000-0000-0000-000000000000',
      },
    ],
  };
  const note = await request('venta', noteDto);
  assert.equal((await request('venta', noteDto)).idFactura, note.idFactura);
  await request(`venta/${original.idFactura}/cancelar`, { motivo: '03' }, 400);
  await request(`venta/${note.idFactura}/cancelar`, { motivo: '03' });
  await request(`venta/${original.idFactura}/cancelar`, { motivo: '03' });
  assert.equal(await stock(), initialStock);
  assert.equal(await cash(), before);
  const today = new Date().toISOString().slice(0, 10);
  const invoiceDto = {
    requestId: randomUUID(),
    idProveedor: supplier.id,
    idOrden: ordered.idOrden,
    serie: 'HTTP',
    folio: 'HTTP-' + randomUUID().slice(0, 8),
    fechaEmision: today,
    fechaVencimiento: today,
    moneda: 'MXN',
    tipoCambio: 1,
    subtotal: 4,
    impuestos: 0,
    retenciones: 0,
    total: 4,
    partidas: [
      {
        idOrdenDetalle: line.id_detalle,
        descripcion: 'HTTP fixture',
        cantidad: 2,
        costoUnitario: 2,
        tasaIva: 0,
      },
    ],
  };
  if (documents) {
    for (const xml of [
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///fixture">]><Comprobante/>',
      'not xml',
    ]) {
      await request(
        'cuentas-proveedor/facturas',
        { ...invoiceDto, requestId: randomUUID(), folio: randomUUID(), xml },
        400,
      );
    }
    const [provider] = await ds.query(
      'SELECT "RFC" rfc FROM proveedor WHERE "IdProveedor"=$1',
      [supplier.id],
    );
    invoiceDto.xml = `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="4"><cfdi:Emisor Rfc="${provider.rfc}"/></cfdi:Comprobante>`;
    for (const xml of [
      invoiceDto.xml.replace('Total="4"', 'Total="9"'),
      invoiceDto.xml.replace(provider.rfc, 'INVALIDRFC'),
    ]) {
      await request(
        'cuentas-proveedor/facturas',
        { ...invoiceDto, requestId: randomUUID(), folio: randomUUID(), xml },
        400,
      );
    }
  }
  const invoice = await create(
    'cuentas-proveedor/facturas',
    invoiceDto,
    'idFacturaProveedor',
    { observaciones: 'changed' },
  );
  assert.ok(Number.isSafeInteger(invoice.idFacturaProveedor));
  assert.equal(invoice.estado, 'Conciliada');
  assert.equal(
    (await request('cuentas-proveedor/facturas', invoiceDto))
      .idFacturaProveedor,
    invoice.idFacturaProveedor,
  );
  assert.equal(await stock(), initialStock);
  const route = `cuentas-proveedor/facturas/${invoice.idFacturaProveedor}`;
  const documentResults = documents
    ? await require('./full-app-documents-http').verifyDocumentsHttp({
        ds,
        api,
        headers,
        request,
        invoice,
        invoiceDto,
        user,
        transportProbe,
      })
    : null;
  await request(route + '/aprobar', {});
  const advanceDto = {
    requestId: randomUUID(),
    idProveedor: supplier.id,
    idFacturaProveedor: invoice.idFacturaProveedor,
    fecha: today,
    monto: 1,
    montoAplicar: 1,
    formaPago: 'Efectivo',
  };
  if (retries)
    await request(
      'cuentas-proveedor/anticipos',
      { ...advanceDto, requestId: invoiceDto.requestId },
      409,
    );
  const advance = await create(
    'cuentas-proveedor/anticipos',
    advanceDto,
    'idAnticipo',
    { monto: 2 },
  );
  assert.equal(
    (await request('cuentas-proveedor/anticipos', advanceDto)).idAnticipo,
    advance.idAnticipo,
  );
  const creditDto = {
    requestId: randomUUID(),
    idProveedor: supplier.id,
    idFacturaProveedor: invoice.idFacturaProveedor,
    folio: 'HTTP-NC-' + randomUUID().slice(0, 8),
    fecha: today,
    total: 1,
    montoAplicar: 1,
  };
  const credit = await create(
    'cuentas-proveedor/notas-credito',
    creditDto,
    'idNota',
    { total: 2 },
  );
  assert.equal(
    (await request('cuentas-proveedor/notas-credito', creditDto)).idNota,
    credit.idNota,
  );
  const paymentDto = {
    requestId: randomUUID(),
    fecha: today,
    monto: 2,
    formaPago: 'Efectivo',
  };
  if (retries) {
    const cashBefore = await cash();
    assert.match(paymentDto.requestId, /^[a-f0-9-]{36}$/);
    await ds.query(
      `CREATE FUNCTION q04_supplier_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${paymentDto.requestId}'::uuid THEN RAISE EXCEPTION 'Q04 injected response failure' USING ERRCODE='XX000'; END IF; RETURN NEW; END $$; CREATE TRIGGER q04_supplier_fail BEFORE INSERT ON operation_idempotency FOR EACH ROW EXECUTE FUNCTION q04_supplier_fail()`,
    );
    try {
      await request(route + '/pagos', paymentDto, 500);
      assert.equal(await cash(), cashBefore);
      assert.equal(
        Number(
          (
            await ds.query(
              'SELECT count(*) n FROM factura_proveedor_pago WHERE request_id=$1',
              [paymentDto.requestId],
            )
          )[0].n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await ds.query(
              'SELECT saldo_pendiente FROM factura_proveedor WHERE id_factura_proveedor=$1',
              [invoice.idFacturaProveedor],
            )
          )[0].saldo_pendiente,
        ),
        2,
      );
    } finally {
      await ds.query(
        'DROP TRIGGER q04_supplier_fail ON operation_idempotency; DROP FUNCTION q04_supplier_fail()',
      );
    }
  }
  const payment = await create(route + '/pagos', paymentDto, 'idPago', {
    monto: 3,
  });
  assert.equal(
    (await request(route + '/pagos', paymentDto)).idPago,
    payment.idPago,
  );
  let [state] = await ds.query(
    'SELECT estado,saldo_pendiente FROM factura_proveedor WHERE id_factura_proveedor=$1',
    [invoice.idFacturaProveedor],
  );
  assert.equal(state.estado, 'Pagada');
  assert.equal(Number(state.saldo_pendiente), 0);
  await request(route + '/cancelar', { motivo: 'HTTP fixture' }, 409);
  await request(`cuentas-proveedor/pagos/${payment.idPago}/revertir`, {
    motivo: 'HTTP refund confirmed',
  });
  await request(
    `cuentas-proveedor/pagos/${payment.idPago}/revertir`,
    { motivo: 'HTTP repeat' },
    409,
  );
  await request(route + '/cancelar', { motivo: 'HTTP fixture' });
  assert.equal(
    (await request(route + '/cancelar', { motivo: 'HTTP fixture' })).repeated,
    true,
  );
  [state] = await ds.query(
    'SELECT estado,saldo_pendiente FROM factura_proveedor WHERE id_factura_proveedor=$1',
    [invoice.idFacturaProveedor],
  );
  assert.equal(state.estado, 'Cancelada');
  assert.equal(Number(state.saldo_pendiente), 0);
  assert.equal(
    (
      await ds.query(
        'SELECT estado FROM factura_proveedor_pago WHERE id_pago=$1',
        [payment.idPago],
      )
    )[0].estado,
    'Revertido',
  );
  assert.equal(
    Number(
      (
        await ds.query(
          'SELECT saldo_disponible FROM anticipo_proveedor WHERE id_anticipo=$1',
          [advance.idAnticipo],
        )
      )[0].saldo_disponible,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await ds.query(
          'SELECT saldo_disponible FROM nota_credito_proveedor WHERE id_nota=$1',
          [credit.idNota],
        )
      )[0].saldo_disponible,
    ),
    1,
  );
  const policies = await ds.query(
    `SELECT estado FROM poliza_contable WHERE (origen_tipo='FacturaProveedor' AND origen_id=$1) OR (origen_tipo='PagoFacturaProveedor' AND origen_id=$2) OR (origen_tipo='AplicacionProveedor' AND origen_id IN(SELECT id_aplicacion FROM aplicacion_proveedor WHERE id_factura_proveedor=$1))`,
    [invoice.idFacturaProveedor, payment.idPago],
  );
  assert.equal(policies.length, 4);
  assert.ok(policies.every((row) => row.estado === 'Cancelada'));
  assert.equal(await stock(), initialStock);
  assert.equal(
    await cash(),
    before - 100,
    'Anticipo liberado permanece disponible; no equivale a reembolso en caja',
  );
  if (retries) {
    const legacy = {
      requestId: randomUUID(),
      idProveedor: supplier.id,
      folio: 'HTTP-LEGACY-' + randomUUID().slice(0, 8),
      fecha: today,
      total: 1,
    };
    await ds.query(
      'INSERT INTO nota_credito_proveedor(request_id,id_proveedor,folio,fecha,total,saldo_disponible,id_user) VALUES($1,$2,$3,$4,1,1,$5)',
      [legacy.requestId, supplier.id, legacy.folio, today, user.id_user],
    );
    await request('cuentas-proveedor/notas-credito', legacy, 409);
    assert.equal(
      Number(
        (
          await ds.query(
            'SELECT count(*) n FROM operation_idempotency WHERE request_id=$1',
            [legacy.requestId],
          )
        )[0].n,
      ),
      0,
    );
  }
  return {
    documents: documentResults,
    legacyRejected: retries,
    concurrentEight: retries,
    rollbackAndRetry: retries,
    payloadConflicts: retries ? 5 : 0,
    devolucionesConRedondeo: true,
    notaCreditoYCancelacion: true,
    cuentasProveedorLiquidadasRevertidas: true,
    polizasCanceladas: true,
    anticiposYNotasLiberados: true,
    permission403: true,
    dto400: true,
    unauthorized401: true,
    replays: 6,
    businessConflicts409: 2,
    cashCentsDelta: -100,
  };
}
module.exports = { verifyReversalsHttp };
