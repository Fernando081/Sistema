import { limpiarConsulta, MAX_VISTAS_POR_LISTADO, VistasGuardadasService } from './vistas-guardadas.service';

function setup(existing = 0, updateRows: unknown[] = []) {
  const sql: Array<{ text: string; params?: unknown[] }> = [];
  const manager = {
    query: jest.fn((text: string, params?: unknown[]) => {
      sql.push({ text, params });
      if (text.startsWith('UPDATE vista_guardada')) return Promise.resolve(updateRows);
      if (text.includes('count(*)')) return Promise.resolve([{ n: existing }]);
      if (text.startsWith('INSERT INTO vista_guardada')) return Promise.resolve([{ idVista: 7, ruta: params?.[1], nombre: params?.[2], consulta: params?.[3] }]);
      if (text.startsWith('DELETE FROM vista_guardada')) return Promise.resolve(params?.[1] === 3 ? [{ id: params?.[0] }] : []);
      return Promise.resolve([]);
    }),
  };
  const dataSource = { ...manager, transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)) };
  return { service: new VistasGuardadasService(dataSource as never), sql };
}

describe('VistasGuardadasService (U02.2)', () => {
  it('limpia la consulta: sólo parámetros conocidos, sin página ni vacíos, en orden estable', () => {
    expect(limpiarConsulta('?page=4&estado=Pagada&q=%20filtro%20&foo=1&tipo=&desde=2026-10-01&order=asc'))
      .toBe('q=filtro&order=asc&estado=Pagada&desde=2026-10-01');
    expect(limpiarConsulta('q=' + 'x'.repeat(300))).toBe('q=' + 'x'.repeat(200));
  });

  it('crea la vista del usuario con la consulta limpia', async () => {
    const { service, sql } = setup();
    const vista = await service.save(3, { ruta: '/facturas', nombre: 'Pendientes', consulta: 'estado=Pendiente&page=2' });
    expect(vista).toEqual(expect.objectContaining({ idVista: 7, consulta: 'estado=Pendiente' }));
    expect(sql.find((x) => x.text.startsWith('INSERT'))?.params).toEqual([3, '/facturas', 'Pendientes', 'estado=Pendiente']);
  });

  it('el mismo nombre actualiza la vista existente sin insertar otra', async () => {
    const { service, sql } = setup(5, [{ idVista: 2, nombre: 'Pendientes', consulta: 'estado=Pagada' }]);
    await service.save(3, { ruta: '/facturas', nombre: 'pendientes', consulta: 'estado=Pagada' });
    expect(sql.some((x) => x.text.startsWith('INSERT'))).toBe(false);
  });

  it('limita el número de vistas por listado', async () => {
    const { service } = setup(MAX_VISTAS_POR_LISTADO);
    await expect(service.save(3, { ruta: '/producto', nombre: 'Otra', consulta: '' })).rejects.toThrow('Máximo');
  });

  it('sólo elimina vistas propias y no distingue las ajenas de las inexistentes', async () => {
    const { service } = setup();
    await expect(service.remove(3, 9)).resolves.toEqual({ message: 'Vista eliminada' });
    await expect(service.remove(4, 9)).rejects.toThrow('Vista no encontrada');
  });
});
