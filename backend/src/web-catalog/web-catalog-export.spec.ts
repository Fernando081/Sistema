import { exportWebCandidate } from './web-catalog-export';
import { WebCatalogService } from './web-catalog.service';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
const snapshot = {
  codigo: 'TEST',
  marca: 'Prueba',
  categoria: 'Prueba',
  titulo: 'Prueba',
  descripcion: 'Fixture solo en memoria',
  aplicaciones: [],
  numerosParte: [],
  especificaciones: [],
  costo: 999,
  VIN: 'privado',
  imagenes: ['/uploads/privado.png'],
  fuenteCompatibilidad: 'nota interna',
};
describe('Exportación comercial controlada', () => {
  it('vigencia exige hash exacto de la proyección actual', async () => {
    const candidate = exportWebCandidate('prueba', snapshot);
    const raw = JSON.stringify(
      {
        schemaVersion: 1,
        products: candidate.products.map((item) => ({
          ...item,
          status: 'published',
          approved: true,
        })),
      },
      null,
      2,
    );
    for (const [sha256, active] of [
      [createHash('sha256').update(raw).digest('hex'), true],
      ['incorrecto', false],
    ] as const) {
      const query = jest
        .fn()
        .mockResolvedValueOnce([{ version: 2, sha256, revoked: false }])
        .mockResolvedValueOnce([
          {
            slug: 'prueba',
            version: 2,
            estado: 'listo',
            datosRealesConfirmados: true,
            derechosImagenConfirmados: true,
            compatibilidadVerificada: true,
            snapshot,
          },
        ]);
      expect(
        (
          await new WebCatalogService({
            query,
          } as unknown as DataSource).approvalStatus(1, 9)
        ).active,
      ).toBe(active);
    }
  });
  it('invalida recibos revocados o de versiones anteriores', async () => {
    for (const event of [
      { version: 1, sha256: 'old', revoked: false },
      { version: 2, sha256: 'old', revoked: true },
    ]) {
      const query = jest
        .fn()
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([
          {
            version: 2,
            estado: 'listo',
            datosRealesConfirmados: true,
            derechosImagenConfirmados: true,
            compatibilidadVerificada: true,
          },
        ]);
      const service = new WebCatalogService({ query } as unknown as DataSource);
      expect((await service.approvalStatus(1, 9)).active).toBe(false);
    }
  });
  it('rechaza recibos de otra ficha y revocación sin confirmación', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new WebCatalogService({ query } as unknown as DataSource);
    await expect(service.approvalStatus(2, 9)).rejects.toThrow(
      'Recibo no encontrado',
    );
    await expect(service.revokeApproval(1, 9, false, 3)).rejects.toThrow(
      'Confirma',
    );
  });
  it('revocación repetida no inserta otro evento', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id_producto: 1 }])
      .mockResolvedValueOnce([{ id: 9 }])
      .mockResolvedValueOnce([{ id: 10 }]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    } as unknown as DataSource;
    expect(
      await new WebCatalogService(source).revokeApproval(1, 9, true, 3),
    ).toMatchObject({ revoked: true });
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('registra aprobación de versión exacta sin incluir datos privados', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          slug: 'prueba',
          version: 2,
          estado: 'listo',
          datosRealesConfirmados: true,
          derechosImagenConfirmados: true,
          compatibilidadVerificada: true,
          snapshot,
        },
      ])
      .mockResolvedValueOnce([{ id: 9, timestamp: 'test' }]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    } as unknown as DataSource;
    const result = await new WebCatalogService(source).approveCandidate(
      1,
      2,
      true,
      3,
    );
    expect(JSON.parse(result.raw).products[0]).toMatchObject({
      status: 'published',
      approved: true,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(query.mock.calls[1][1][1]).toBe(3);
    expect(query.mock.calls[1][1][0]).not.toMatch(/VIN|costo|nota interna/);
    await expect(
      new WebCatalogService(source).approveCandidate(1, 2, false, 3),
    ).rejects.toThrow('Confirma');
  });
  it('bloquea aprobación de una versión que cambió', async () => {
    const query = jest.fn().mockResolvedValue([{ version: 3 }]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    } as unknown as DataSource;
    await expect(
      new WebCatalogService(source).approveCandidate(1, 2, true, 3),
    ).rejects.toThrow('cambió');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('rechaza borradores, retirados y confirmaciones faltantes', async () => {
    for (const profile of [
      { estado: 'borrador' },
      { estado: 'retirado' },
      { estado: 'listo', datosRealesConfirmados: false },
    ]) {
      const query = jest.fn().mockResolvedValue([profile]);
      const source = { query } as unknown as DataSource;
      await expect(
        new WebCatalogService(source).exportCandidate(1),
      ).rejects.toThrow('Solo se exportan');
    }
  });
  it('proyecta campos permitidos sin aprobar o publicar', () => {
    const result = exportWebCandidate('prueba', snapshot);
    expect(result.products[0]).toMatchObject({
      status: 'draft',
      approved: false,
      code: 'TEST',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /costo|VIN|uploads|nota interna/,
    );
  });
  it('rechaza campos comerciales faltantes y slugs inválidos', () => {
    expect(() => exportWebCandidate('../admin', snapshot)).toThrow();
    expect(() =>
      exportWebCandidate('prueba', { ...snapshot, codigo: null }),
    ).toThrow();
  });
});
