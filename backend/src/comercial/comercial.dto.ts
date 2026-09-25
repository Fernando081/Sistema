import { Transform,Type } from 'class-transformer';
import { IsBoolean,IsDateString,IsIn,IsInt,IsNumber,IsOptional,IsString,MaxLength,Min } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SimularPrecioDto{@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(.000001)cantidad:number;@IsNumber({maxDecimalPlaces:6})@Min(0)@IsOptional()precioPropuesto?:number;}
export class ConfigClienteDto{@IsInt()@Min(1)@IsOptional()idLista?:number|null;@IsNumber({maxDecimalPlaces:2})@Min(0)limiteCredito:number;@IsInt()@Min(0)diasCredito:number;@IsBoolean()bloqueado=false;@Transform(trim)@IsString()@MaxLength(500)@IsOptional()motivoBloqueo?:string;}
export class CreateListaDto{@Transform(trim)@IsString()@MaxLength(100)nombre:string;@IsDateString()@IsOptional()validFrom?:string;@IsDateString()@IsOptional()validTo?:string;}
export class SetPrecioListaDto{@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(.000001)cantidadMinima=1;@IsNumber({maxDecimalPlaces:6})@Min(0)precio:number;}
export class SetPrecioEspecialDto{@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)idProducto:number;@IsNumber({maxDecimalPlaces:6})@Min(0)precio:number;@IsDateString()@IsOptional()validFrom?:string;@IsDateString()@IsOptional()validTo?:string;}
export class CreateAutorizacionDto{@IsIn(['Descuento','Margen bajo','Exceso credito'])tipo:string;@IsInt()@Min(1)idCliente:number;@IsInt()@Min(1)@IsOptional()idProducto?:number;@IsNumber()valorSolicitado:number;@IsNumber()valorReferencia:number;@Transform(trim)@IsString()@MaxLength(1000)motivo:string;}
export class ResolverAutorizacionDto{@IsIn(['Aprobada','Rechazada'])estado:'Aprobada'|'Rechazada';@Transform(trim)@IsString()@MaxLength(1000)resolucion:string;@Type(()=>Number)@IsInt()@Min(1)@IsOptional()vigenciaHoras=24;}
