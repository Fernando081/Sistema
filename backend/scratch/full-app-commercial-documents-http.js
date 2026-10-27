const { localLoadFetch, readLoadBody } = require('./local-load-fetch');
const assert = require('node:assert/strict');
async function verifyCommercialDocumentsHttp({
  ds,
  api,
  headers,
  request,
  sold,
  paid,
  sale,
  user,
}) {
  assert.equal(process.env.FISCAL_MODE, 'mock');
  assert.match(
    (await ds.query('SELECT current_database() name'))[0].name,
    /^sistema_http_\d+_[a-f0-9]{6}$/,
  );
  const get = async (route, status = 200, auth = headers) => {
    const response = await localLoadFetch(api + route, {
      headers: auth,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== status)
      throw new Error(
        `${route}: ${response.status} expected ${status}; ${(await readLoadBody(response, 'text')).slice(0, 400)}`,
      );
    return response;
  };
  const quote = await request('cotizacion', {
    idCliente: sale.idCliente,
    nombreReceptor: sale.nombreReceptor,
    rfcReceptor: sale.rfcReceptor,
    subtotal: 10,
    totalImpuestos: 0,
    totalRetenciones: 0,
    total: 10,
    conceptos: [
      {
        idProducto: sale.conceptos[0].idProducto,
        descripcion: 'Documento HTTP',
        unidadDescripcion: 'Pieza',
        cantidad: 1,
        valorUnitario: 10,
        importe: 10,
        importeIva: 0,
        importeRetIsr: 0,
      },
    ],
  });
  const routes = [
    `venta/${sold.idFactura}/pdf`,
    `cotizacion/${quote.id}/pdf`,
    `pago/${paid.idRep}/pdf`,
  ];
  await get(`pago/${paid.idRep}/xml`, 400); // Origin invoice must be stamped first.
  for (const route of routes) {
    await get(route, 401, {});
    const response = await get(route);
    const bytes = Buffer.from(await readLoadBody(response, 'arrayBuffer'));
    assert.ok(bytes.length > 100);
    assert.match(
      response.headers.get('content-disposition'),
      /filename=.*\.(pdf|xml)/,
    );
    if (route.endsWith('/pdf')) {
      assert.match(response.headers.get('content-type'), /^application\/pdf/);
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(bytes.subarray(-1024).includes(Buffer.from('%%EOF')));
    } else {
      assert.match(response.headers.get('content-type'), /^application\/xml/);
      assert.match(bytes.toString(), /Comprobante/);
      assert.equal(response.headers.get('x-fiscal-mode'), 'mock');
    }
  }
  for (const prefix of ['venta', 'cotizacion', 'pago']) {
    await get(`${prefix}/123abc/pdf`, 400);
    await get(`${prefix}/2147483647/pdf`, 404);
  }
  await get('pago/123abc/xml', 400);
  await get('pago/2147483647/xml', 404);
  for (const [type, id] of [
    ['facturas', sold.idFactura],
    ['reps', paid.idRep],
  ]) {
    const route = `fiscal/${type}/${id}`;
    await get(route + '/xml', 404);
    await get(route + '/xml', 401, {});
    await request(route + '/timbrar', {}, 401, {});
    await ds.query(
      "INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,'fiscal.timbrar',false)",
      [user.id_user],
    );
    try {
      await request(route + '/timbrar', {}, 403);
    } finally {
      await ds.query(
        "DELETE FROM app_user_permission WHERE id_user=$1 AND permission_code='fiscal.timbrar'",
        [user.id_user],
      );
    }
    if (type === 'reps') {
      const draft = await get(`pago/${paid.idRep}/xml`);
      assert.equal(draft.headers.get('x-fiscal-mode'), 'mock');
      assert.match(await readLoadBody(draft, 'text'), /Comprobante/);
    }
    await request(route + '/timbrar', {});
    const response = await get(route + '/xml');
    const xml = await readLoadBody(response, 'text');
    assert.match(response.headers.get('content-type'), /^application\/xml/);
    assert.match(xml, /MOCK UUID .*SIN VALIDEZ FISCAL/);
    const column = type === 'facturas' ? 'id_factura' : 'id_rep';
    const [stored] = await ds.query(
      `SELECT xml_timbrado xml,uuid FROM fiscal_documento WHERE ${column}=$1`,
      [id],
    );
    assert.equal(xml, stored.xml);
    await request(route + '/timbrar', {});
    assert.equal(await readLoadBody(await get(route + '/xml'), 'text'), xml);
  }
  await get('fiscal/unknown/1/xml', 404);
  return {
    ticketPdf: true,
    quotePdf: true,
    repPdf: true,
    repDraftXml: true,
    mockStampedXml: true,
    malformedIds400: true,
    missing404: true,
    anonymous401: true,
    stampPermission403: true,
    stampedReplayStable: true,
  };
}
module.exports = { verifyCommercialDocumentsHttp };
