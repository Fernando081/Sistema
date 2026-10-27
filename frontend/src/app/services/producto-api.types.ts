import { Producto } from '../producto/producto.interface';

export interface ProductoDb {
  IdProducto: number;
  Codigo: string | null;
  Descripcion: string;
  PrecioUnitario: number | string;
  Marca: string | null;
  Ubicacion: string | null;
  IdUnidad: number | null;
  IdObjetoImpuesto: number | null;
  IdCategoria: number | null;
  IdClaveProdOServ: number | null;
  IdClaveUnidad: number | null;
  CategoriaNombre?: string | null;
  ClaveProdServ?: string | null;
  DescripcionProdServ?: string | null;
  ClaveUnidadSat?: string | null;
  DescripcionUnidadSat?: string | null;
  ObjetoImpuesto: string;
  TasaIVA: number | string;
  AplicaRetencionISR: boolean;
  AplicaRetencionIVA: boolean;
  Existencia?: number | string;
  Reservada?: number | string;
  Disponible?: number | string;
  EquivalentesJSON?: number[];
  imagenes?: string[];
}

export interface ProductoPagina<T = Producto> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface HistorialPrecio {
  fecha: string;
  precio: number | string;
  referencia: string | null;
  tipo_movimiento: string;
}

export interface ProductoEquivalente {
  id_producto_eq: number;
  codigo: string | null;
  descripcion: string;
  precio: number | string;
  existencia: number | string;
}

export interface NumeroParteInput {
  tipo: 'OEM' | 'Fabricante' | 'Alterno';
  fabricante?: string;
  numero: string;
}
export interface NumeroParte extends Omit<NumeroParteInput, 'fabricante'> {
  idNumero: number;
  fabricante: string | null;
  numeroNormalizado: string;
}

export interface AplicacionInput {
  fabricanteEquipo?: string | null;
  modelo?: string | null;
  motor?: string | null;
  anioDesde?: number | null;
  anioHasta?: number | null;
  restricciones?: string | null;
}
export interface AplicacionProducto extends AplicacionInput { idAplicacion: number; }

export interface CotizacionProveedorInput {
  idProveedor: number;
  marcaOfrecida?: string;
  precioCotizado: number;
  diasEntrega: number;
}
export interface CotizacionProveedor {
  id_cotizacion_prov: number;
  id_producto: number;
  id_proveedor: number;
  proveedor_nombre: string;
  marca_ofrecida: string | null;
  precio_cotizado: number | string;
  dias_entrega: number;
  fecha_registro: string;
}
export interface CotizacionProveedorGrupo extends CotizacionProveedor {
  history: CotizacionProveedor[];
  esMasBarato: boolean;
}

export interface MensajeProducto { message: string; }
