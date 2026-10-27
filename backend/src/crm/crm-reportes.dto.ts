import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class CrmReporteCrearDto {
 @IsUUID('4') requestId!:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value)
 @IsString() @IsNotEmpty() @MaxLength(120) nombre!:string;
 @IsIn(['Diaria','Semanal']) frecuencia!:'Diaria'|'Semanal';
 @IsInt() @Min(0) @Max(23) hora!:number;
 @IsIn([0,10,20,30,40,50]) minuto!:number;
 @IsOptional() @IsInt() @Min(1) @Max(7) dia?:number;
 @IsIn(['todos','tarea','oportunidad','cotizacion','web']) tipo!:string;
 @IsIn(['todos','vencidas','hoy','proximas','sin-fecha']) plazo!:string;
}
export class CrmReporteControlDto {
 @IsBoolean() activa!:boolean;
 @IsInt() @Min(1) expectedVersion!:number;
}
export class CrmReporteReintentoDto {
 @Equals(true) confirmacion!:boolean;
}
export class CrmReporteCancelarReintentoDto extends CrmReporteReintentoDto {
 @IsInt() @Min(1) expectedVersion!:number;
}
