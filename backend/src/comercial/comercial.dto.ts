import { Transform,Type } from 'class-transformer';
import { IsBoolean,IsDateString,IsIn,IsInt,IsNumber,IsOptional,IsString,Max,MaxLength,Min,MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SimularPrecioDto{@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(.000001)cantidad:number;@IsNumber({maxDecimalPlaces:6})@Min(0)@IsOptional()precioPropuesto?:number;}
export class ConfigClienteDto{@IsInt()@Min(1)@IsOptional()idLista?:number|null;@IsNumber({maxDecimalPlaces:2})@Min(0)limiteCredito:number;@IsInt()@Min(0)@Max(365)diasCredito:number;@IsBoolean()bloqueado=false;@Transform(trim)@IsString()@MaxLength(500)@IsOptional()motivoBloqueo?:string;}
export class CreateListaDto{@Transform(trim)@IsString()@MinLength(1)@MaxLength(100)nombre:string;@IsDateString()@IsOptional()validFrom?:string;@IsDateString()@IsOptional()validTo?:string;}
export class SetPrecioListaDto{@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(.000001)cantidadMinima=1;@IsNumber({maxDecimalPlaces:6})@Min(0)precio:number;}
export class SetPrecioEspecialDto{@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(0)precio:number;@IsDateString()@IsOptional()validFrom?:string;@IsDateString()@IsOptional()validTo?:string;}
export class CreateAutorizacionDto{@IsIn(['Descuento','Margen bajo','Exceso credito'])tipo:string;@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)@IsOptional()idProducto?:number;@IsNumber({maxDecimalPlaces:6})@Min(0)@Max(999999999999)valorSolicitado:number;@IsNumber({maxDecimalPlaces:6})@Min(0)@Max(999999999999)valorReferencia:number;@Transform(trim)@IsString()@MaxLength(1000)motivo:string;}
export class ResolverAutorizacionDto{@IsIn(['Aprobada','Rechazada'])estado:'Aprobada'|'Rechazada';@Transform(trim)@IsString()@MinLength(1)@MaxLength(1000)resolucion:string;@Type(()=>Number)@IsInt()@Min(1)@Max(720)@IsOptional()vigenciaHoras=24;}

export class SolicitarAutorizacionDto extends CreateAutorizacionDto {
 @IsIn(['Venta','Pedido','Cotizacion'])operacionDestino:'Venta'|'Pedido'|'Cotizacion';
 @IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)montoOperacion:number;
}
export class ReglaAprobacionDto {
 @IsIn(['Venta','Pedido','Cotizacion'])operacion:'Venta'|'Pedido'|'Cotizacion';
 @IsIn(['Descuento','Margen bajo','Exceso credito'])tipo:string;
 @IsBoolean()requiereDistinto:boolean;
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)montoMaximo?:number|null;
 @IsInt()@Min(1)@Max(720)vigenciaMaximaHoras:number;
 @IsInt()@Min(1)version:number;
 @Transform(trim)@IsString()@MinLength(1)@MaxLength(1000)motivo:string;
}
export class LimiteAprobadorDto {
 @IsIn(['Venta','Pedido','Cotizacion'])operacion:'Venta'|'Pedido'|'Cotizacion';
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)montoMaximo?:number|null;
 @IsInt()@Min(0)version:number;
 @Transform(trim)@IsString()@MinLength(1)@MaxLength(1000)motivo:string;
}
