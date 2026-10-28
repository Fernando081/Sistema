// Fecha calendario del negocio (Tampico) para valores por defecto de formularios.
// toISOString() usa UTC y después de las 18:00 locales propone el día siguiente.
export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function businessDate(date = new Date()): string {
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
