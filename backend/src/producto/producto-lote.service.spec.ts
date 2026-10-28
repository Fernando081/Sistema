import { nuevoPrecio, ProductoLoteService } from './producto-lote.service';

const productos = [
  { idProducto: 1, codigo: 'A', descripcion: 'Filtro', precio: '100.00', idCategoria: 1, categoria: 'Balero' },
  { idProducto: 2, codigo: 'B', descripcion: 'Banda', precio: '33.33', idCategoria: 4, categoria: 'Bandas' },
];

function setup(idempotente: unknown[] = []) {
  const updates: unknown[][] = [];
  const manager = {
    query: jest.fn((text: string, params?: unknown[]) => {
      if (text.includes('FROM producto p')) return Promise.resolve(productos);
      if (text.includes('FROM categoria WHERE')) return Promise.resolve(params?.[0] === 3 ? [{ nombre: 'Aceite' }] : []);
      if (text.includes('FROM operation_idempotency')) return Promise.resolve(idempotente);
      if (text.startsWith('UPDATE producto')) updates.push(params ?? []);
      return Promise.resolve([]);
    }),
  };
  const ds = { ...manager, transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) };
  return { service: new ProductoLoteService(ds as never), updates };
}

describe('ProductoLoteService (U02.3)', () => {
  it('calcula precios por porcentaje con redondeo a centavos o pesos', () => {
    expect(nuevoPrecio(100, 10, 'centavos')).toBe(110);
    expect(nuevoPrecio(33.33, 7.5, 'centavos')).toBe(35.83);
    expect(nuevoPrecio(33.33, 7.5, 'pesos')).toBe(36);
    expect(nuevoPrecio(0.5, -90, 'centavos')).toBe(0.05);
    expect(nuevoPrecio(0.4, -90, 'pesos')).toBe(1);
  });

  it('la vista previa no escribe y resume el cambio', async () => {
    const { service, updates } = setup();
    const r = await service.vistaPrevia({ ids: [1, 2], accion: 'precio', porcentaje: 10, redondeo: 'centavos' });
    expect(r.cambios.map((c) => c.precioNuevo)).toEqual([110, 36.66]);
    expect(r.resumen).toEqual({ productos: 2, conCambio: 2, totalActual: 133.33, totalNuevo: 146.66 });
    expect(updates).toEqual([]);
  });

  it('aplica sólo si los valores no cambiaron desde la vista previa', async () => {
    let ctx = setup();
    const base = { requestId: '3f6c1f62-2a1b-4c5d-9e8f-0a1b2c3d4e5f', ids: [1, 2], accion: 'categoria' as const, idCategoria: 3 };
    const r = await ctx.service.aplicar({ ...base, esperados: [{ idProducto: 1, precio: 100, idCategoria: 1 }, { idProducto: 2, precio: 33.33, idCategoria: 4 }] }, 9);
    expect(r).toEqual(expect.objectContaining({ actualizados: 2 }));
    expect(ctx.updates).toEqual([[1, 3], [2, 3]]);

    ctx = setup();
    await expect(ctx.service.aplicar({ ...base, esperados: [{ idProducto: 1, precio: 90, idCategoria: 1 }, { idProducto: 2, precio: 33.33, idCategoria: 4 }] }))
      .rejects.toThrow('desde la vista previa');
    expect(ctx.updates).toEqual([]);
  });

  it('rechaza categorías inexistentes y productos repetidos', async () => {
    const { service } = setup();
    await expect(service.vistaPrevia({ ids: [1, 2], accion: 'categoria', idCategoria: 99 })).rejects.toThrow('categoría no existe');
    await expect(service.vistaPrevia({ ids: [1, 1], accion: 'precio', porcentaje: 5, redondeo: 'centavos' })).rejects.toThrow('repetidos');
  });

  it('un reintento con el mismo requestId devuelve la respuesta guardada sin volver a escribir', async () => {
    const { service, updates } = setup([{ payload_hash: 'x', response: { actualizados: 2 } }]);
    await expect(service.aplicar({ requestId: '3f6c1f62-2a1b-4c5d-9e8f-0a1b2c3d4e5f', ids: [1], accion: 'precio', porcentaje: 5, redondeo: 'centavos', esperados: [{ idProducto: 1, precio: 100 }] }))
      .rejects.toThrow('datos diferentes');
    expect(updates).toEqual([]);
  });
});
