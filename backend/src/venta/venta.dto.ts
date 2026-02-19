// backend/src/venta/venta.dto.ts
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// 1. DTO para cada Renglón del carrito (Concepto)
export class ConceptoVentaDto {
  @IsNumber() idProducto: number;
  @IsString() claveProdServ: string;
  @IsString() claveUnidad: string;
  @IsString() objetoImpuesto: string; // '02'
  @IsString() codigo: string;
  @IsString() descripcion: string;
  @IsString() unidadDescripcion: string; // 'Pieza'

  @IsNumber() cantidad: number;
  @IsNumber() valorUnitario: number;
  @IsNumber() importe: number;
  @IsNumber() @IsOptional() descuento: number;

  // Impuestos calculados desde Angular
  @IsNumber() baseIva: number;
  @IsNumber() tasaIva: number;
  @IsNumber() importeIva: number;

  @IsNumber() @IsOptional() baseRetIsr: number;
  @IsNumber() @IsOptional() tasaRetIsr: number;
  @IsNumber() @IsOptional() importeRetIsr: number;
}

// 2. DTO para la Venta General (Cabecera)
export class CreateVentaDto {
  @IsNumber() idCliente: number;

  // Datos fiscales del receptor (Snapshot)
  @IsString() rfcReceptor: string;
  @IsString() nombreReceptor: string;
  @IsString() cpReceptor: string;
  @IsString() regimenReceptor: string;
  @IsString() usoCfdi: string;

  @IsNumber() idFormaPago: number;
  @IsNumber() idMetodoPago: number;
  @IsString() moneda: string; // 'MXN'
  @IsNumber() tipoCambio: number; // 1

  // Totales
  @IsNumber() subtotal: number;
  @IsNumber() totalImpuestosTrasladados: number;
  @IsNumber() totalImpuestosRetenidos: number;
  @IsNumber() total: number;

  // LA LISTA DE PRODUCTOS
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConceptoVentaDto) // Transforma el JSON a objetos Concepto
  conceptos: ConceptoVentaDto[];
}
