import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
const alias=({value}:{value:unknown})=>typeof value==='string'?value.trim().toLowerCase():value;
export class PortalInvitarDto {
 @IsUUID() requestId:string;
 @Transform(alias) @Matches(/^[a-z0-9][a-z0-9._-]{2,79}$/) alias:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) nombre:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
}
export class PortalCambiarAccesoDto {
 @IsUUID() requestId:string;
 @Type(()=>Number) @IsInt() @Min(1) @Max(2147483647) version:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
}
export class PortalLoginDto {
 @Transform(alias) @IsString() @MaxLength(80) alias:string;
 @IsString() @MinLength(1) @MaxLength(256) password:string;
}
export class PortalActivarDto {
 @Matches(/^[A-Za-z0-9_-]{43}$/) token:string;
 @IsString() @MinLength(12) @MaxLength(72) password:string;
}
export class PortalPasswordDto {
 @IsString() @MinLength(1) @MaxLength(256) actual:string;
 @IsString() @MinLength(12) @MaxLength(72) nueva:string;
}
export class PortalQuery {
 @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1;
 @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q='';
}
