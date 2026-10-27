import { InternalServerErrorException } from '@nestjs/common';

/** PostgreSQL int8 IDs must match the numeric HTTP DTO contract. Money stays unchanged. */
export function supplierJson<T>(value: T): T {
  const visit = (item: unknown, key = ''): unknown => {
    if (
      /^id(?:[A-Z_]|$)/.test(key) &&
      typeof item === 'string' &&
      /^\d+$/.test(item)
    ) {
      const id = Number(item);
      if (!Number.isSafeInteger(id) || id < 1)
        throw new InternalServerErrorException(
          'Identificador de proveedor fuera del rango seguro',
        );
      return id;
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (
      item !== null &&
      typeof item === 'object' &&
      (Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null)
    ) {
      return Object.fromEntries(
        Object.entries(item).map(([field, entry]) => [
          field,
          visit(entry, field),
        ]),
      );
    }
    return item;
  };
  return visit(value) as T;
}
