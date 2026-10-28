// Fechas del negocio en hora de Tampico. toISOString() devuelve UTC: después de las
// 18:00 locales produce el día siguiente y en CFDI una hora que no es la del emisor.
export const BUSINESS_TIME_ZONE = 'America/Mexico_City';

const dateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** `YYYY-MM-DDTHH:mm:ss` local, sin zona: formato de los atributos de fecha del SAT. */
export function businessDateTime(value: Date | string = new Date()): string {
  return dateTimeFormatter.format(new Date(value)).replace(' ', 'T');
}

/** `YYYY-MM-DD` del calendario local. */
export function businessDate(value: Date | string = new Date()): string {
  return businessDateTime(value).slice(0, 10);
}
