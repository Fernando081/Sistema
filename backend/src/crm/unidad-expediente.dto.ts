import { Transform,Type } from 'class-transformer';
import { IsDateString,IsIn,IsInt,IsNumber,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class ExpedienteQuery {
 @Type(()=>Number)@IsInt()@Min(1)@Max(1000000)lecturasPage=1;
 @Type(()=>Number)@IsInt()@Min(1)@Max(1000000)mantenimientosPage=1;
}
export class LecturaUnidadDto {
 @IsUUID()requestId:string;
 @IsDateString()@Matches(/(?:Z|[+-]\d{2}:\d{2})$/)fecha:string;
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)kilometraje?:number|null;
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)horas?:number|null;
 @IsOptional()@Transform(trim)@IsString()@MaxLength(1000)notas?:string;
}
export class MotivoExpedienteDto {
 @Transform(trim)@IsString()@MinLength(1)@MaxLength(1000)motivo:string;
}
export class MantenimientoUnidadDto {
 @IsUUID()requestId:string;
 @Transform(trim)@IsString()@MinLength(1)@MaxLength(150)titulo:string;
 @IsOptional()@Transform(trim)@IsString()@MaxLength(1000)notas?:string;
 @IsOptional()@IsDateString()@Matches(/^\d{4}-\d{2}-\d{2}$/)fechaObjetivo?:string|null;
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)kilometrajeObjetivo?:number|null;
 @IsOptional()@IsNumber({maxDecimalPlaces:2})@Min(0)@Max(999999999999)horasObjetivo?:number|null;
}
export class CerrarMantenimientoDto extends MotivoExpedienteDto {
 @IsInt()@Min(1)version:number;
 @IsIn(['Realizado','Cancelado'])estado:'Realizado'|'Cancelado';
 @IsOptional()@IsDateString()@Matches(/(?:Z|[+-]\d{2}:\d{2})$/)fechaRealizada?:string;
}
export class ArchivoUnidadDto {
 @IsUUID()requestId:string;
 @Transform(trim)@IsString()@MinLength(1)@MaxLength(150)titulo:string;
}
