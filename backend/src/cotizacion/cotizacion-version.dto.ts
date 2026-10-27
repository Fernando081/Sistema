import { Transform, Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CreateCotizacionDto } from './cotizacion.dto';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class VersionQuery { @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1; }
export class SellarCotizacionDto {
 @IsUUID() requestId:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) motivo:string;
}
export class NuevaRevisionDto extends CreateCotizacionDto {
 @IsUUID() requestId:string;
 @IsInt() @Min(1) revisionAnterior:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) motivo:string;
}
export class TokenCotizacionDto { @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token:string; }
export class InvitarCotizacionDto { @IsUUID() requestId:string; }
export class ResponderCotizacionDto extends TokenCotizacionDto {
 @IsUUID() requestId:string;
 @IsIn(['Aceptada','Rechazada']) decision:'Aceptada'|'Rechazada';
 @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) nombre:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000) comentario:string;
 @Equals(true) confirmacion:boolean;
}
