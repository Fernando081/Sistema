import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { WebCatalogService, webImagePaths } from './web-catalog.service';
import { SaveWebProductDto } from './web-catalog.dto';
import fs from 'node:fs';

const dto = {
  slug: 'filtro-diesel-123',
  titulo: 'Filtro de combustible diésel',
  descripcion: 'Información técnica revisada para preparar la ficha comercial.',
  estado: 'borrador',
  datosRealesConfirmados: false,
  derechosImagenConfirmados: false,
  compatibilidadVerificada: false,
  version: 0,
} as SaveWebProductDto;
describe('Preparación del catálogo público', () => {
  it('prepara una ficha lista solo con confirmaciones e imagen verificada por el guard', async () => {
    const imageExists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          codigo: '123',
          nombre: 'Parte',
          marca: 'Marca',
          imagenes: ['/uploads/test.png'],
          numerosParte: [],
          aplicaciones: [],
          costo: 999,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ estado: 'listo', version: 1 }]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    };
    try {
      const result = await new WebCatalogService(
        source as unknown as DataSource,
      ).save(
        1,
        {
          ...dto,
          estado: 'listo',
          datosRealesConfirmados: true,
          derechosImagenConfirmados: true,
          compatibilidadVerificada: true,
        },
        1,
      );
      expect(result.estado).toBe('listo');
      expect(JSON.parse(String(query.mock.calls[2][1][8]))).not.toHaveProperty(
        'costo',
      );
      expect(imageExists).toHaveBeenCalled();
    } finally {
      imageExists.mockRestore();
    }
  });
  it('rechaza HTML, slugs inválidos, blancos y confirmaciones con tipo incorrecto', async () => {
    expect(
      await validate(plainToInstance(SaveWebProductDto, dto)),
    ).toHaveLength(0);
    for (const patch of [
      { titulo: '<script>alert()</script>' },
      { titulo: '              ' },
      { slug: '../private' },
      { datosRealesConfirmados: 'true' },
      { imagenes: ['/uploads/../secret.png'] },
      { imagenes: ['/uploads/a.png', '/uploads/a.png'] },
      { equivalencias: [1, 1] },
      { equivalencias: ['1'] },
      { fuenteCompatibilidad: '<script>' },
      {
        especificaciones: [
          { nombre: 'Altura', valor: '12', unidad: '<script>' },
        ],
      },
      { especificaciones: [{ nombre: 'Altura', valor: '12' }] },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(SaveWebProductDto, { ...dto, ...patch }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  it('omite rutas externas, traversal, SVG y valores no textuales de imágenes', () => {
    expect(
      webImagePaths([
        'a.webp',
        '/uploads/a.webp',
        '../a.png',
        'https://other/a.jpg',
        'x.svg',
        null,
      ]),
    ).toEqual(['/uploads/a.webp']);
    expect(webImagePaths(null)).toEqual([]);
  });
  it('rechaza aprobar sin revisión y evita guardar', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          codigo: '123',
          nombre: 'Parte',
          marca: 'Marca',
          imagenes: [],
          numerosParte: [],
          aplicaciones: [],
        },
      ])
      .mockResolvedValueOnce([]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    };
    await expect(
      new WebCatalogService(source as unknown as DataSource).save(
        1,
        { ...dto, estado: 'listo' },
        1,
      ),
    ).rejects.toThrow('Para marcar lista');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('rechaza guardar una versión anterior', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          codigo: '123',
          nombre: 'Parte',
          marca: 'Marca',
          imagenes: [],
          numerosParte: [],
          aplicaciones: [],
        },
      ])
      .mockResolvedValueOnce([{ version: 2 }]);
    const source = {
      transaction: async (
        work: (manager: { query: jest.Mock }) => Promise<unknown>,
      ) => work({ query }),
    };
    await expect(
      new WebCatalogService(source as unknown as DataSource).save(1, dto, 1),
    ).rejects.toThrow('La ficha cambió');
  });
  it('no permite identificadores inválidos ni usuario sin cuenta persistida', async () => {
    const service = new WebCatalogService({
      query: jest.fn(),
    } as unknown as DataSource);
    await expect(service.preview(-1)).rejects.toThrow('Producto inválido');
    await expect(service.save(1, dto, 0)).rejects.toThrow(
      'cuenta administrativa',
    );
  });
});
