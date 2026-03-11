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
  imagenes?: string[];        // Opcional para las fotos Multer
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

export interface SmartRestockItem {
  id_producto: number;
  codigo: string;
  descripcion: string;
  unidades_vendidas_30d: number;
  stock_actual: number;
  precio_unitario: number;
  margen: number;
}

export interface PrediccionDemandaItem {
  id_producto: number;
  codigo: string;
  descripcion: string;
  stock_actual: number;
  precio_unitario: number;
  vendido_30d: number;
  vendido_60d: number;
  vendido_90d: number;
  prom_diario_30d: number;
  prom_diario_60d: number;
  prom_diario_90d: number;
  pendiente_regresion: number;
  intercepto_regresion: number;
  r_cuadrado: number;
  num_semanas: number;
  tendencia: 'ALTA' | 'BAJA' | 'ESTABLE';
  demanda_proyectada_30d: number;
  cantidad_sugerida_compra: number;
}