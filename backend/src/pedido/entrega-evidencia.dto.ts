import { Transform, Type } from 'class-transformer';
import { Equals, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class EntregaEvidenciaDto {
 @IsUUID() requestId:string;
 @Type(()=>Number) @IsInt() @Min(1) @Max(2147483647) version:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) recibidoPor:string;
 @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notas?:string;
 @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) motivoSinEvidencia?:string;
 @Equals('true') confirmacion:string;
 @IsOptional() @Type(()=>Number) @IsNumber() @Min(-90) @Max(90) latitud?:number;
 @IsOptional() @Type(()=>Number) @IsNumber() @Min(-180) @Max(180) longitud?:number;
 @IsOptional() @Type(()=>Number) @IsNumber() @Min(0) @Max(10000000) precision?:number;
 @IsOptional() @IsDateString() @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) ubicacionFecha?:string;
}
