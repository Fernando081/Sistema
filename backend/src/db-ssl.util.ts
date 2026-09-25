import { ConfigService } from '@nestjs/config';

/**
 * Parses the DB_SSL and DB_SSL_REJECT_UNAUTHORIZED environment variables.
 *
 * Returns `false` when SSL is disabled, or an SSL options object when enabled.
 *
 * Verifica certificados por defecto. Una excepción para certificados locales
 * autofirmados debe ser explícita y no se permite en producción.
 */
export function parseSsl(
  configService: ConfigService,
): false | { rejectUnauthorized: boolean } {
  const rawSsl = configService.get<string>('DB_SSL');
  if (!rawSsl) {
    return false;
  }

  const normalized = rawSsl.trim().toLowerCase();
  const truthyValues = new Set(['true', '1', 'yes', 'y', 'on']);

  if (!truthyValues.has(normalized)) {
    return false;
  }

  const rawRejectUnauthorized = (
    configService.get<string>('DB_SSL_REJECT_UNAUTHORIZED') || ''
  )
    .trim()
    .toLowerCase();
  const rejectUnauthorized = rawRejectUnauthorized === '' || truthyValues.has(rawRejectUnauthorized);
  if (!rejectUnauthorized && configService.get<string>('NODE_ENV') === 'production') {
    throw new Error('No se permite deshabilitar la verificación TLS de PostgreSQL en producción');
  }

  return { rejectUnauthorized };
}
