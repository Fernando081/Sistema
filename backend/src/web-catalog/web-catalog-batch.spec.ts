import { validateBatch, matchesBatchProduct } from './web-catalog-batch';
import { exportWebCandidate } from './web-catalog-export';
const snapshot = {
  codigo: 'TEST',
  marca: 'Fixture',
  categoria: 'Fixture',
  titulo: 'Fixture',
  descripcion: 'Solo prueba',
  aplicaciones: [],
  numerosParte: [],
  especificaciones: [],
};
const product = {
  ...exportWebCandidate('fixture', snapshot).products[0],
  status: 'published',
  approved: true,
};
describe('Contrato editorial de lote', () => {
  it('incluye variantes aprobadas y rechaza dimensiones/variantes anidadas', () => {
    const image = {
      file: 'full.png',
      sha256: 'a'.repeat(64),
      alt: 'Fixture',
      authorized: true,
      width: 100,
      height: 100,
    };
    const variant = { ...image, file: 'small.png', width: 50, height: 50 };
    const raw = (variants: unknown[]) =>
      JSON.stringify({
        schemaVersion: 1,
        products: [{ ...product, images: [{ ...image, variants }] }],
      });
    expect(validateBatch(raw([variant]))).toHaveLength(1);
    expect(() => validateBatch(raw([{ ...variant, width: 100 }]))).toThrow();
    expect(() => validateBatch(raw([{ ...variant, variants: [] }]))).toThrow();
    expect(() => validateBatch(raw([variant, variant]))).toThrow();
  });
  it('admite campos comerciales y medios explícitamente autorizados', () => {
    const image = {
      file: 'fixture.png',
      sha256: 'a'.repeat(64),
      alt: 'Fixture',
      width: 1,
      height: 1,
      authorized: true,
    };
    const result = validateBatch(
      JSON.stringify({
        schemaVersion: 1,
        products: [{ ...product, images: [image] }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(() =>
      matchesBatchProduct(result[0], 'fixture', snapshot),
    ).not.toThrow();
  });
  it('rechaza datos privados, imágenes no autorizadas y alternativas fuera de lote', () => {
    for (const patch of [
      { cost: 99 },
      { alternatives: ['privada'] },
      { alternatives: ['fixture'] },
      { images: [{ file: '../secret.png' }] },
    ])
      expect(() =>
        validateBatch(
          JSON.stringify({
            schemaVersion: 1,
            products: [{ ...product, ...patch }],
          }),
        ),
      ).toThrow();
    expect(() =>
      matchesBatchProduct({ ...product, code: 'OTRO' }, 'fixture', snapshot),
    ).toThrow('difiere');
  });
});
