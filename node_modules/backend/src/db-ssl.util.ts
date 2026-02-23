import { ConfigService } from '@nestjs/config';

/**
 * Parses the DB_SSL and DB_SSL_REJECT_UNAUTHORIZED environment variables.
 *
 * Returns `false` when SSL is disabled, or an SSL options object when enabled.
 *
 * NOTE: By default, `rejectUnauthorized` is `false` to support environments
 * with self-signed certificates. This disables TLS certificate validation and
 * is NOT recommended for production. To enforce certificate validation, set
 * `DB_SSL_REJECT_UNAUTHORIZED=true`.
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
  const rejectUnauthorized =
    rawRejectUnauthorized === '' ? false : truthyValues.has(rawRejectUnauthorized);

  return { rejectUnauthorized };
}
