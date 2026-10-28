import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

interface TrackedRequest {
  socket?: { remoteAddress?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

// Detrás del proxy local (Angular/reverse proxy en el mismo equipo) todas las
// peticiones llegan desde 127.0.0.1 y compartirían una sola cuota de 100/min.
// Solo si el socket es loopback se usa la última dirección de X-Forwarded-For,
// que es la que agrega el proxy; un cliente remoto no puede falsificarla.
// No cambia req.ip/req.secure ni la confianza en X-Forwarded-Proto.
export function throttleTracker(req: TrackedRequest): string {
  const remote = req.socket?.remoteAddress ?? req.ip ?? 'unknown';
  if (!LOOPBACK.has(remote)) return remote;
  const header = req.headers?.['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : header;
  const forwarded = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded && forwarded.length <= 64 ? forwarded : remote;
}

@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(throttleTracker(req as TrackedRequest));
  }
}
