import { BadRequestException } from '@nestjs/common';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Ficha comercial inválida');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    throw new BadRequestException('Completa y revisa los campos comerciales');
  return value.trim();
}
function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new BadRequestException('Lista comercial inválida');
  return value.map(object);
}
export function exportWebCandidate(slug: string, snapshot: unknown) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160)
    throw new BadRequestException('Dirección comercial inválida');
  const data = object(snapshot);
  return {
    schemaVersion: 1,
    products: [
      {
        slug,
        status: 'draft',
        approved: false,
        code: text(data.codigo, 200),
        brand: text(data.marca, 200),
        category: text(data.categoria, 200),
        title: text(data.titulo, 200),
        description: text(data.descripcion, 4000),
        applications: list(data.aplicaciones).map((item) => {
          const values = [
            'fabricante',
            'modelo',
            'motor',
            'desde',
            'hasta',
            'restricciones',
          ].flatMap((key) => {
            const value = item[key];
            if (value === null || value === undefined || value === '')
              return [];
            if (typeof value === 'number' && Number.isSafeInteger(value))
              return [String(value)];
            return [text(value)];
          });
          if (!values.length) throw new BadRequestException('Aplicación vacía');
          return values.join(' · ');
        }),
        references: list(data.numerosParte).map((item) =>
          [
            text(item.tipo, 100),
            item.fabricante ? text(item.fabricante, 200) : '',
            text(item.numero, 200),
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        specifications: list(data.especificaciones).map((item) => ({
          name: text(item.nombre, 100),
          value: text(item.valor, 200),
          unit: item.unidad === '' ? '' : text(item.unidad, 40),
        })),
      },
    ],
  };
}
