const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
function createRequest(api, headers, relational, fixtureCount = 20000) {
  async function request(c) {
    const start = performance.now();
    const response = await fetch(
      api + c.route + '?page=1&limit=10&term=' + encodeURIComponent(c.term),
      { headers, signal: AbortSignal.timeout(5000) },
    );
    assert.equal(response.status, 200, `${c.domain}: HTTP ${response.status}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    const result = await response.json();
    assert.ok(Array.isArray(result.data));
    const idKey = {
      cliente: 'IdCliente',
      proveedor: 'IdProveedor',
      producto: 'IdProducto',
      cotizacion: 'id_cotizacion',
      compra: 'id_compra',
      venta: 'id_factura',
    }[c.domain];
    const ids = result.data.map((row) => Number(row[idKey]));
    assert.ok(ids.every(Number.isSafeInteger));
    assert.equal(new Set(ids).size, ids.length);
    if (relational && c.domain === 'producto')
      for (const row of result.data) {
        assert.equal(row.imagenes.length, 2);
        assert.equal(row.EquivalentesJSON.length, 1);
        assert.ok(row.ClaveProdServ);
        assert.ok(row.ClaveUnidadSat);
        assert.equal(Number(row.Disponible), Number(row.Existencia));
      }
    assert.equal(result.page, 1);
    assert.equal(result.totalPages, Math.ceil(result.total / 10));
    if (c.term === 'Q04HTTPONLY') {
      assert.ok(result.total === 0 || result.total === 1);
      assert.equal(result.data.length, result.total);
    } else {
      assert.equal(result.total, c.term ? fixtureCount / 1000 : fixtureCount);
      assert.equal(result.data.length, Math.min(10, result.total));
    }
    return performance.now() - start;
  }

  return request;
}
module.exports = { createRequest };
