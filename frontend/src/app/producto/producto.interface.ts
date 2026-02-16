// frontend/src/app/producto/producto.interface.ts (REEMPLAZAR)
export interface Producto {
  idProducto: number;
  codigo: string;
  idUnidad: number;
  idObjetoImpuesto: number;
  descripcion: string;
  precioUnitario: number;
  idCategoria: number;
  ubicacion: string;
  idClaveProdOServ: number;
  idClaveUnidad: number;
  marca: string;
  
  // --- CAMPOS VIRTUALES (JOINS) ---
  categoriaNombre?: string; // <--- SOLO UNA VEZ
  claveProdServ?: string;
  descripcionProdServ?: string;
  claveUnidadSat?: string;
  descripcionUnidadSat?: string;
  
  // --- CAMPOS FISCALES (RESICO) ---
  objetoImpuestoSat: string;
  tasaIva: number;
  aplicaRetencionIsr: boolean;
  aplicaRetencionIva: boolean;
  existencia: number;

  equivalentesIds?: number[]; // Viene de la BD
  esEquivalente?: boolean;    // Lo usaremos en el frontend para colorear
}

// Interfaz específica para lo que devuelve tu query SQL de Kardex
export interface KardexItem {
  id_kardex: number;
  fecha: string;
  // Estos strings deben coincidir con tu ENUM de Postgres
  tipo_movimiento: 'COMPRA' | 'VENTA' | 'AJUSTE_MANUAL_STOCK' | 'CAMBIO_PRECIO' | 'INVENTARIO_INICIAL';
  cantidad: number;        // Puede ser negativo o positivo
  stock_anterior: number;
  stock_resultante: number;
  precio_unitario: number;
  referencia: string;
  usuario?: string;
}

export type CreateProductoDto = Omit<Producto, 'idProducto' | 'categoriaNombre' | 'claveProdServ' | 'descripcionProdServ' | 'claveUnidadSat' | 'descripcionUnidadSat'>;
export type UpdateProductoDto = Partial<CreateProductoDto>;