import { Type,Transform } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,Equals,IsArray,IsIn,IsInt,IsNotEmpty,IsOptional,IsString,IsUUID,Max,MaxLength,Min,ValidateNested } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SecuenciaPasoDto {
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(180) titulo!:string;
 @Transform(trim) @IsString() @MaxLength(2000) descripcion!:string;
 @IsIn(['Baja','Media','Alta','Urgente']) prioridad!:'Baja'|'Media'|'Alta'|'Urgente';
 @IsInt() @Min(0) @Max(720) horas!:number;
}
export class SecuenciaModeloDto {
 @IsUUID('4') requestId!:string;
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) nombre!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({each:true}) @Type(()=>SecuenciaPasoDto) pasos!:SecuenciaPasoDto[];
}
export class SecuenciaInicioDto {
 @IsUUID('4') requestId!:string;
 @IsUUID('4') idModelo!:string;
 @IsInt() @Min(1) @Max(2147483647) idCliente!:number;
 @IsInt() @Min(1) @Max(2147483647) idResponsable!:number;
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) motivo!:string;
 @Equals(true) confirmacion!:boolean;
}
export class SecuenciaQuery {
 @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
 @Transform(trim) @IsString() @MaxLength(120) q='';
}
export class SecuenciaTransicionDto {
 @IsString() @MaxLength(20) @IsNotEmpty() idTarea!:string;
 @IsInt() @Min(1) expectedVersion!:number;
 @IsIn(['En progreso','Completada','Cancelada']) estado!:'En progreso'|'Completada'|'Cancelada';
}
export class SecuenciaControlDto {
 @IsUUID('4') requestId!:string;
 @IsInt() @Min(1) expectedVersion!:number;
 @IsIn(['Pausar','Reanudar','Reasignar']) accion!:'Pausar'|'Reanudar'|'Reasignar';
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) motivo!:string;
 @IsOptional() @IsInt() @Min(1) @Max(2147483647) idResponsable?:number;
 @Equals(true) confirmacion!:boolean;
}
