import { resolve } from 'node:path';

// Ruta estable al arrancar desde raíz, backend, ts-node o dist.
export const UPLOAD_DIRECTORY = resolve(__dirname, '..', '..', 'uploads');
