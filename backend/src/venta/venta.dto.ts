// backend/src/venta/venta.dto.ts
import {
  IsArray,
  ArrayMinSize,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  IsDateString,
  ArrayMaxSize,
  ArrayUnique,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// 1. DTO para cada Renglón del carrito (Concepto)
export class ConceptoVentaDto {
  @IsInt() @Min(1) idProducto: number;
  @IsString() claveProdServ: string;
  @IsString() claveUnidad: string;
  @IsString() objetoImpuesto: string; // APP_CONSTANTS.TAX_OBJECT_DEFAULT
  @IsString() codigo: string;
  @IsString() descripcion: string;
  @IsString() unidadDescripcion: string; // 'Pieza'

  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) cantidad: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) valorUnitario: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) importe: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() descuento: number;

  // Impuestos calculados desde Angular
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) baseIva: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1) tasaIva: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) importeIva: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() baseRetIsr: number;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1) @IsOptional() tasaRetIsr: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() importeRetIsr: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagenes?: string[];
}

export class CfdiRelacionadoDto {
  @IsString()
  @IsIn(['01', '02', '03', '04', '05', '06', '07'])
  tipoRelacion: string;

  @IsUUID()
  uuidRelacionado: string;
}

// 2. DTO para la Venta General (Cabecera)
export class CreateVentaDto {
  @IsOptional() @IsInt() @Min(1)
  idPedido?: number;
  @IsOptional() @IsInt() @Min(1)
  idFacturaOrigen?: number;
  @IsUUID()
  @IsOptional()
  requestId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['I', 'E'])
  tipoComprobante?: string;

  @IsString()
  @IsOptional()
  @IsIn(['A', 'F', 'G', 'NC'])
  serie?: string;

  @IsString()
  @IsOptional()
  @IsIn(['Efectivo', 'Saldo a Favor'])
  metodoReembolso?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CfdiRelacionadoDto)
  cfdisRelacionados?: CfdiRelacionadoDto[];
  @IsInt() @Min(1) idCliente: number;

  // Datos fiscales del receptor (Snapshot)
  @IsString() rfcReceptor: string;
  @IsString() nombreReceptor: string;
  @IsString() cpReceptor: string;
  @IsString() regimenReceptor: string;
  @IsString() usoCfdi: string;

  @IsInt() @Min(1) idFormaPago: number;
  @IsInt() @Min(1) idMetodoPago: number;
  @IsString() moneda: string; // 'MXN'
  @IsNumber() @Min(0.000001) tipoCambio: number; // 1

  // Totales
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) subtotal: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalImpuestosTrasladados: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalImpuestosRetenidos: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) total: number;

  // LA LISTA DE PRODUCTOS
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConceptoVentaDto)
  conceptos: ConceptoVentaDto[];
}

// 3. DTO para la Devolución Parcial (CFDI Egreso)
export class DevolverArticuloDto {
  @IsInt() @Min(1) idProducto: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) cantidad: number;
}

export class ProcesarDevolucionDto {
  @IsString()
  @IsIn(['Efectivo', 'Saldo a Favor'])
  metodoReembolso: 'Efectivo' | 'Saldo a Favor';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DevolverArticuloDto)
  articulos: DevolverArticuloDto[];
}

export class FacturaGlobalQueryDto {
  @IsDateString({ strict: true }) fechaInicio: string;
  @IsDateString({ strict: true }) fechaFin: string;
}

export class GenerarFacturaGlobalDto extends FacturaGlobalQueryDto {
  @IsArray() @ArrayMinSize(1)
  @ArrayMaxSize(1000) @ArrayUnique()
  @IsInt({ each: true }) @Min(1, { each: true }) idsTickets: number[];
}
