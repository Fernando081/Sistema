// backend/src/compra/compra.dto.ts
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DetalleCompraDto {
  @IsNumber() idProducto: number;
  @IsString() 
  @IsOptional() // <--- Agregamos esto para permitir el campo
  codigo: string; // <--- EL CULPABLE ERA ESTE QUE FALTABA
  @IsString() descripcion: string;
  @IsNumber() cantidad: number;
  @IsNumber() costoUnitario: number; // Costo de compra
  @IsNumber() importe: number;
}

export class CreateCompraDto {
  @IsNumber() idProveedor: number;
  @IsString() @IsOptional() folioFactura: string; // Folio del proveedor (opcional)
  @IsNumber() total: number;
  @IsString() @IsOptional() observaciones: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetalleCompraDto)
  conceptos: DetalleCompraDto[];
}