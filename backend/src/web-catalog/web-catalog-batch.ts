function unsafe(value: string) {
  return Array.from(value).some(
    (character) =>
      character === '<' || character === '>' || character.charCodeAt(0) < 32,
  );
}
import { BadRequestException } from '@nestjs/common';
import { exportWebCandidate } from './web-catalog-export';
function fail(): never {
  throw new BadRequestException('Manifiesto de lote inválido');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    fail();
}
export function validateBatch(raw: string) {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    fail();
  }
  const manifest = object(input);
  exact(manifest, ['schemaVersion', 'products']);
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.products) ||
    manifest.products.length < 1 ||
    manifest.products.length > 25
  )
    fail();
  const fields = [
    'slug',
    'status',
    'approved',
    'code',
    'brand',
    'category',
    'title',
    'description',
    'applications',
    'references',
    'specifications',
  ];
  const products = manifest.products.map((value) => {
    const product = object(value);
    exact(product, fields, ['images', 'alternatives']);
    if (product.status !== 'published' || product.approved !== true) fail();
    for (const key of [
      'slug',
      'code',
      'brand',
      'category',
      'title',
      'description',
    ])
      if (
        typeof product[key] !== 'string' ||
        !product[key].trim() ||
        product[key].length > (key === 'description' ? 4000 : 200) ||
        unsafe(product[key])
      )
        fail();
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug as string) ||
      (product.slug as string).length > 160
    )
      fail();
    for (const key of ['applications', 'references'])
      if (
        !Array.isArray(product[key]) ||
        product[key].length > 100 ||
        product[key].some(
          (value) =>
            typeof value !== 'string' ||
            !value.trim() ||
            value.length > 2000 ||
            unsafe(value),
        )
      )
        fail();
    if (
      !Array.isArray(product.specifications) ||
      product.specifications.length > 100
    )
      fail();
    for (const value of product.specifications) {
      const spec = object(value);
      exact(spec, ['name', 'value', 'unit']);
      for (const key of ['name', 'value', 'unit'])
        if (
          typeof spec[key] !== 'string' ||
          spec[key].length >
            (key === 'name' ? 100 : key === 'unit' ? 40 : 200) ||
          (key !== 'unit' && !spec[key].trim()) ||
          unsafe(spec[key])
        )
          fail();
    }
    if (product.images !== undefined) {
      if (!Array.isArray(product.images) || product.images.length > 8) fail();
      for (const value of product.images) {
        const parent = object(value);
        const variants = parent.variants === undefined ? [] : parent.variants;
        if (!Array.isArray(variants) || variants.length > 3) fail();
        const widths = new Set<number>();
        for (const entry of [parent, ...(variants as unknown[])]) {
          const image = object(entry);
          exact(
            image,
            ['file', 'sha256', 'alt', 'width', 'height', 'authorized'],
            entry === parent ? ['variants'] : [],
          );
          if (
            typeof image.file !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(image.file) ||
            typeof image.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(image.sha256) ||
            image.authorized !== true ||
            typeof image.alt !== 'string' ||
            !image.alt.trim() ||
            image.alt.length > 200 ||
            unsafe(image.alt)
          )
            fail();
          for (const key of ['width', 'height'])
            if (
              !Number.isInteger(image[key]) ||
              (image[key] as number) < 1 ||
              (image[key] as number) > 4096
            )
              fail();
          if (entry !== parent) {
            const width = image.width as number,
              height = image.height as number;
            if (
              widths.has(width) ||
              width >= (parent.width as number) ||
              Math.abs(
                height / width -
                  (parent.height as number) / (parent.width as number),
              ) >
                1 / width
            )
              fail();
            widths.add(width);
          }
        }
      }
    }
    if (
      product.alternatives !== undefined &&
      (!Array.isArray(product.alternatives) ||
        product.alternatives.length > 12 ||
        new Set(product.alternatives).size !== product.alternatives.length)
    )
      fail();
    return product;
  });
  const slugs = new Set(products.map((product) => product.slug));
  if (slugs.size !== products.length) fail();
  for (const product of products)
    for (const slug of (product.alternatives ?? []) as unknown[])
      if (typeof slug !== 'string' || slug === product.slug || !slugs.has(slug))
        fail();
  return products;
}
export function matchesBatchProduct(
  product: Record<string, unknown>,
  slug: string,
  snapshot: unknown,
) {
  const candidate = exportWebCandidate(slug, snapshot).products[0];
  for (const key of [
    'slug',
    'code',
    'brand',
    'category',
    'title',
    'description',
    'applications',
    'references',
    'specifications',
  ] as const)
    if (JSON.stringify(product[key]) !== JSON.stringify(candidate[key]))
      throw new BadRequestException('El lote difiere de la ficha guardada');
}
