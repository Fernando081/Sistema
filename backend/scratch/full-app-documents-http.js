const { localLoadFetch, readLoadBody } = require('./local-load-fetch');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function verifyDocumentsHttp({
  ds,
  api,
  headers,
  request,
  invoice,
  invoiceDto,
  user,
  transportProbe = false,
}) {
  assert.match(
    (await ds.query('SELECT current_database() name'))[0].name,
    /^sistema_http_\d+_[a-f0-9]{6}$/,
  );
  const route = `cuentas-proveedor/facturas/${invoice.idFacturaProveedor}`;
  const download = async (suffix, expected = 200, auth = headers) => {
    const response = await localLoadFetch(api + suffix, {
      headers: auth,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, expected, suffix);
    return response;
  };
  for (const kind of ['pdf', 'xml']) {
    if (kind === 'pdf') await download(route + '/' + kind, 404);
    await download(route + '/' + kind, 401, {});
    await download('cuentas-proveedor/facturas/2147483647/' + kind, 404);
  }
  const xml = invoiceDto.xml;
  const xmlResponse = await download(route + '/xml');
  assert.match(xmlResponse.headers.get('content-type'), /^application\/xml/);
  assert.match(
    xmlResponse.headers.get('content-disposition'),
    /attachment; filename=factura_proveedor_\d+\.xml/,
  );
  assert.equal(await readLoadBody(xmlResponse, 'text'), xml);
  const [xmlStored] = await ds.query(
    'SELECT xml_sha256 hash FROM factura_proveedor WHERE id_factura_proveedor=$1',
    [invoice.idFacturaProveedor],
  );
  assert.equal(xmlStored.hash, hash(xml));
  // Minimal deterministic PDF fixture; bytes, MIME and EOF validation, no visual certification.
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
  const upload = async (
    bytes,
    mime,
    expected,
    auth = headers,
    field = 'pdf',
  ) => {
    const body = new FormData();
    if (bytes)
      body.append(field, new Blob([bytes], { type: mime }), 'fixture.pdf');
    const response = await localLoadFetch(api + route + '/pdf', {
      method: 'POST',
      headers: auth,
      body,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, expected, `upload ${mime}`);
    return readLoadBody(response, 'json');
  };
  assert.equal((await upload(pdf, 'application/pdf', 201)).sha256, hash(pdf));
  const pdfResponse = await download(route + '/pdf');
  assert.match(pdfResponse.headers.get('content-type'), /^application\/pdf/);
  assert.match(
    pdfResponse.headers.get('content-disposition'),
    /inline; filename=factura_proveedor_\d+\.pdf/,
  );
  assert.deepEqual(
    Buffer.from(await readLoadBody(pdfResponse, 'arrayBuffer')),
    pdf,
  );
  await upload(null, 'application/pdf', 400);
  await upload(pdf, 'application/pdf', 400, headers, 'unexpected');
  await upload(pdf, 'text/plain', 400);
  await upload(Buffer.from('not PDF'), 'application/pdf', 400);
  await upload(Buffer.from('%PDF-1.4 missing EOF'), 'application/pdf', 400);
  await upload(pdf, 'application/pdf', 401, {});
  await upload(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 413);
  if (transportProbe) {
    for (let i = 0; i < 12; i++) {
      await upload(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 413);
      assert.deepEqual(
        Buffer.from(
          await readLoadBody(await download(route + '/pdf'), 'arrayBuffer'),
        ),
        pdf,
      );
      assert.equal(
        await readLoadBody(await download(route + '/xml'), 'text'),
        xml,
      );
    }
  }
  await ds.query(
    "INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,'compras.facturas',false) ON CONFLICT(id_user,permission_code) DO UPDATE SET granted=false",
    [user.id_user],
  );
  try {
    await upload(pdf, 'application/pdf', 403);
  } finally {
    await ds.query(
      "DELETE FROM app_user_permission WHERE id_user=$1 AND permission_code='compras.facturas'",
      [user.id_user],
    );
  }
  const [stored] = await ds.query(
    'SELECT pdf_sha256 hash,pdf_original data FROM factura_proveedor WHERE id_factura_proveedor=$1',
    [invoice.idFacturaProveedor],
  );
  assert.equal(stored.hash, hash(pdf));
  assert.deepEqual(stored.data, pdf);
  return {
    pdfRoundtrip: true,
    xmlRoundtrip: true,
    missingPdf404: true,
    nonexistentInvoice404: true,
    unauthorized401: true,
    uploadPermission403: true,
    invalid400: true,
    oversized413: true,
    transportProbeCycles: transportProbe ? 12 : 0,
    rejectedUploadsPreserveOriginal: true,
    unsafeXml400: true,
    xmlCreatedOverHttp: true,
  };
}
module.exports = { verifyDocumentsHttp };
