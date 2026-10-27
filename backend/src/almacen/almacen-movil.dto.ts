import { Transform, Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class MovilPageQuery {
 @Type(()=>Number) @IsInt() @Min(1) @Max(10000) page=1;
 @Transform(trim) @IsString() @MaxLength(40) q='';
 @IsIn(['pendientes','todos']) estado='pendientes';
}
export class VerificarPickingDto {
 @IsUUID('4') requestId!:string;
 @IsString() @Matches(/^[1-9]\d{0,18}$/) idSurtido!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) evaluacionSha256!:string;
 @Transform(trim) @IsString() @MaxLength(160) @IsNotEmpty() producto!:string;
 @Transform(trim) @IsString() @MaxLength(160) @IsNotEmpty() ubicacion!:string;
 @IsString() @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/) cantidad!:string;
 @IsIn(['Manual','Lector','Camara']) metodo!:'Manual'|'Lector'|'Camara';
 @Equals(true) confirmacion!:boolean;
}
export class AnularPickingDto {
 @IsUUID('4') requestId!:string;
 @IsUUID('4') idVerificacion!:string;
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) motivo!:string;
 @Equals(true) confirmacion!:boolean;
}
