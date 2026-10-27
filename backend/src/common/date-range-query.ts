import { ValidateBy } from 'class-validator';
export function validInvoiceDate(value: unknown): boolean {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export class DateRangeQueryDto {
  @ValidateBy({ name: 'invoiceDate', validator: { validate: validInvoiceDate } }) desde = '';
  @ValidateBy({ name: 'invoiceDateRange', validator: { validate: (value, args) => validInvoiceDate(value) && (!value || !args || !(args.object as DateRangeQueryDto).desde || value >= (args.object as DateRangeQueryDto).desde) } }) hasta = '';
}
