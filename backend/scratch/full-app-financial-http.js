const { localLoadFetch, readLoadBody } = require('./local-load-fetch');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function verifyFinancialHttp(ds, api, headers, options = {}) {
  assert.equal(process.env.TEST_DATABASE_ISOLATED, 'true');
  assert.match(
    (await ds.query('SELECT current_database() name'))[0].name,
    /^sistema_http_\d+_[a-f0-9]{6}$/,
  );
  const request = async (route, body, expected = 201, auth = headers) => {
    const response = await localLoadFetch(api + route, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await readLoadBody(response, 'json');
    assert.equal(
      response.status,
      expected,
      `${route}: HTTP ${response.status}, expected ${expected}; ${JSON.stringify(data.message ?? '').slice(0, 500)}`,
    );
    return data;
  };
  const [client] = await ds.query(
    'SELECT "IdCliente" id,"RFC" rfc,"RazonSocial" nombre,"CodigoPostal" cp FROM cliente WHERE "IdCliente"=1',
  );
  const [supplier] = await ds.query(
    'SELECT "IdProveedor" id FROM proveedor ORDER BY "IdProveedor" LIMIT 1',
  );
  const catalog = async (table, column, key) =>
    (
      await ds.query(`SELECT "${column}" id FROM ${table} WHERE "Clave"=$1`, [
        key,
      ])
    )[0].id;
  const form = await catalog('formadepago', 'IdFormaPago', '01');
  const ppd = await catalog('metododepago', 'IdMetodoDePago', 'PPD');
  const tax = await catalog('objetoimpuesto', 'IdObjetoImpuesto', '01');
  const [product] = await ds.query(
    `INSERT INTO producto("Codigo","Descripcion","IdObjetoImpuesto","PrecioUnitario","Existencia","ObjetoImpuesto","TasaIVA","AplicaRetencionISR") VALUES($1,'HTTP financial fixture',$2,10,100,'01',0,false) RETURNING "IdProducto" id`,
    ['HTTP-' + randomUUID().slice(0, 12), tax],
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
  const before = await cash();
  const [user] = await ds.query(
    "SELECT id_user FROM auth_user WHERE username LIKE 'q04http%' ORDER BY id_user DESC LIMIT 1",
  );
  const denied = ['ventas.crear', 'compras.autorizar', 'compras.recibir'];
  try {
    for (const code of denied)
      await ds.query(
        'INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,$2,false)',
        [user.id_user, code],
      );
    for (const route of [
      'venta',
      'abastecimiento/ordenes',
      'abastecimiento/ordenes/1/recepciones',
    ])
      await request(route, {}, 403);
  } finally {
    await ds.query(
      'DELETE FROM app_user_permission WHERE id_user=$1 AND permission_code=ANY($2::text[])',
      [user.id_user, denied],
    );
  }
  for (const route of [
    'compra',
    'venta',
    'pago/rep',
    'pedidos',
    'abastecimiento/ordenes',
  ]) {
    await request(route, {}, 401, {});
    await request(route, {}, 400);
  }
  const purchase = {
    requestId: randomUUID(),
    idProveedor: supplier.id,
    esCredito: false,
    formaPago: 'Efectivo',
    total: 10,
    conceptos: [
      {
        idProducto: product.id,
        descripcion: 'HTTP fixture',
        cantidad: 5,
        costoUnitario: 2,
        importe: 10,
      },
    ],
  };
  const bought = await request('compra', purchase);
  assert.equal((await request('compra', purchase)).idCompra, bought.idCompra);
  assert.equal(await stock(), 105);
  assert.equal(await cash(), before - 1000);
  const sale = {
    requestId: randomUUID(),
    idCliente: client.id,
    rfcReceptor: client.rfc,
    nombreReceptor: client.nombre,
    cpReceptor: client.cp,
    regimenReceptor: '616',
    usoCfdi: 'G03',
    idFormaPago: form,
    idMetodoPago: ppd,
    moneda: 'MXN',
    tipoCambio: 1,
    subtotal: 10,
    totalImpuestosTrasladados: 0,
    totalImpuestosRetenidos: 0,
    total: 10,
    tipoComprobante: 'I',
    serie: 'A',
    conceptos: [
      {
        idProducto: product.id,
        cantidad: 1,
        valorUnitario: 10,
        importe: 10,
        descuento: 0,
        claveProdServ: '31171500',
        claveUnidad: 'H87',
        objetoImpuesto: '01',
        codigo: 'HTTP',
        descripcion: 'HTTP fixture',
        unidadDescripcion: 'Pieza',
        baseIva: 0,
        tasaIva: 0,
        importeIva: 0,
        baseRetIsr: 0,
        tasaRetIsr: 0,
        importeRetIsr: 0,
      },
    ],
  };
  const sold = await request('venta', sale);
  assert.equal((await request('venta', sale)).idFactura, sold.idFactura);
  await request('venta', { ...sale, total: 11 }, 409);
  assert.equal(await stock(), 104);
  assert.equal(await cash(), before - 1000);
  const rep = {
    requestId: randomUUID(),
    idCliente: client.id,
    fechaPago: new Date().toISOString(),
    formaPago: 'Efectivo',
    moneda: 'MXN',
    montoTotal: 10,
    facturas: [{ idFactura: sold.idFactura, montoSaldado: 10 }],
  };
  const paid = await request('pago/rep', rep);
  assert.equal((await request('pago/rep', rep)).idRep, paid.idRep);
  await request('pago/rep', { ...rep, montoTotal: 11 }, 409);
  assert.equal(await cash(), before);
  assert.equal(
    Number(
      (
        await ds.query(
          'SELECT saldo_pendiente FROM factura WHERE id_factura=$1',
          [sold.idFactura],
        )
      )[0].saldo_pendiente,
    ),
    0,
  );
  const commercialDocuments = options.commercialDocuments
    ? await require('./full-app-commercial-documents-http').verifyCommercialDocumentsHttp(
        { ds, api, headers, request, sold, paid, sale, user },
      )
    : null;
  const order = await request('pedidos', {
    requestId: randomUUID(),
    idCliente: client.id,
    partidas: [{ idProducto: product.id, cantidad: 1, valorUnitario: 10 }],
  });
  const confirmed = await request(`pedidos/${order.idPedido}/confirmar`, {});
  assert.equal(confirmed.estado, 'Confirmado');
  const fulfilled = await request(`pedidos/${order.idPedido}/surtir`, {
    partidas: [{ idDetalle: confirmed.partidas[0].idDetalle, cantidad: 1 }],
  });
  assert.equal(fulfilled.estado, 'Surtido');
  assert.equal(
    (
      await request(`pedidos/${order.idPedido}/entregar`, {
        recibidoPor: 'HTTP fixture',
      })
    ).estado,
    'Entregado',
  );
  const invoice = await request(`pedidos/${order.idPedido}/facturar`, {
    requestId: randomUUID(),
    idFormaPago: form,
    idMetodoPago: ppd,
  });
  assert.ok(invoice.idFactura);
  assert.equal(
    (
      await ds.query('SELECT estado FROM pedido_venta WHERE id_pedido=$1', [
        order.idPedido,
      ])
    )[0].estado,
    'Facturado',
  );
  assert.equal(await stock(), 103);
  const solicitation = await request('abastecimiento/solicitudes', {
    requestId: randomUUID(),
    motivo: 'HTTP fixture',
    partidas: [
      {
        idProducto: product.id,
        cantidad: 2,
        costoEstimado: 2,
        origen: 'Manual',
      },
    ],
  });
  await request(
    `abastecimiento/solicitudes/${solicitation.idSolicitud}/autorizar`,
    {},
  );
  const supply = {
    requestId: randomUUID(),
    idProveedor: supplier.id,
    idSolicitud: solicitation.idSolicitud,
    partidas: [
      { idProducto: product.id, cantidad: 2, costoUnitario: 2, tasaIva: 0 },
    ],
  };
  const ordered = await request('abastecimiento/ordenes', supply);
  assert.equal(
    (await request('abastecimiento/ordenes', supply)).idOrden,
    ordered.idOrden,
  );
  await request('abastecimiento/ordenes', { ...supply, notas: 'changed' }, 409);
  const [line] = await ds.query(
    'SELECT id_detalle FROM orden_compra_detalle WHERE id_orden=$1',
    [ordered.idOrden],
  );
  const receipt = {
    requestId: randomUUID(),
    partidas: [{ idDetalle: line.id_detalle, cantidad: 2 }],
  };
  const received = await request(
    `abastecimiento/ordenes/${ordered.idOrden}/recepciones`,
    receipt,
  );
  assert.equal(
    (
      await request(
        `abastecimiento/ordenes/${ordered.idOrden}/recepciones`,
        receipt,
      )
    ).idRecepcion,
    received.idRecepcion,
  );
  await request(
    `abastecimiento/ordenes/${ordered.idOrden}/recepciones`,
    { ...receipt, notas: 'changed' },
    409,
  );
  const reversals = options.reversals
    ? await require('./full-app-reversals-http').verifyReversalsHttp({
        ds,
        request,
        sale,
        product,
        supplier,
        ordered,
        line,
        form,
        user,
        retries: options.retries,
        documents: options.documents,
        transportProbe: options.transportProbe,
        api,
        headers,
      })
    : null;
  assert.equal(await stock(), 105);
  assert.equal(await cash(), before + (reversals?.cashCentsDelta ?? 0));
  const [physical] = await ds.query(
    'SELECT coalesce(sum(cantidad),0) n FROM inventario_ubicacion WHERE id_producto=$1',
    [product.id],
  );
  assert.equal(Number(physical.n), 105);
  const [receiptTotal] = await ds.query(
    'SELECT sum(cantidad_recibida) n FROM orden_compra_detalle WHERE id_orden=$1',
    [ordered.idOrden],
  );
  assert.equal(Number(receiptTotal.n), 2);
  return {
    commercialDocuments,
    reversals,
    compra: true,
    ventaPpd: true,
    rep: true,
    pedidoFacturado: true,
    ordenRecepcion: true,
    solicitudAutorizada: true,
    stockPhysicalAligned: true,
    cashAndBalanceAligned: true,
    unauthorized401: true,
    dto400: true,
    permission403: true,
    replays: 5,
    conflicts409: 4,
  };
}
module.exports = { verifyFinancialHttp };
