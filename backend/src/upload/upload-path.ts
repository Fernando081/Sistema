import { resolve } from 'node:path';

// Ruta estable al arrancar desde raíz, backend, ts-node o dist.
// O04 · Una versión desplegada (releases/<id>) recibe UPLOAD_DIRECTORY del proceso para compartir los archivos
// operativos de backend/uploads; se lee al cargar el módulo, por eso no aplica si sólo está en backend/.env.
export const UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY?.trim()
  ? resolve(process.env.UPLOAD_DIRECTORY.trim())
  : resolve(__dirname, '..', '..', 'uploads');
