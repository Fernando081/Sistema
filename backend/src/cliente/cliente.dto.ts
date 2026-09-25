// backend/src/cliente/cliente.dto.ts
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  MinLength,
  IsPostalCode,
  IsEmail,
  IsBoolean,
  IsIn,
  Min,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

// DTO para Crear un Cliente (Validación)
export class CreateClienteDto {
  @Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim().toUpperCase() : value;
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(13)
  rfc: string;

  @Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  razonSocial: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  pais: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  idEstado: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  idMunicipio: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  ciudad: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  colonia: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  calle: string;

  @IsString()
  @IsNotEmpty()
  @IsPostalCode('MX') // Valida que sea un CP de México
  @MaxLength(5)
  codigoPostal: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  numeroExterior: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  numeroInterior: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  referencia: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  idMetodoDePago: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  idUsoCFDI: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  idFormaPago: number;

  @IsInt()
  @Min(1)
  @IsNotEmpty()
  idRegimenFiscal: number;

  @Transform((params: TransformFnParams) => {
    const value = params.value as unknown;
    return typeof value === 'string' ? value.trim() || null : value;
  })
  @IsString()
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;
}

// DTO para Actualizar (la mayoría de campos son opcionales)
// Usamos PartialType para no reescribir todo.
import { PartialType } from '@nestjs/mapped-types';
export class UpdateClienteDto extends PartialType(CreateClienteDto, { skipNullProperties: false }) {}

const trimNullable = (params: TransformFnParams) => {
  const value = params.value as unknown;
  return typeof value === 'string' ? value.trim() || null : value;
};

export class CreateClienteContactoDto {
  @Transform(trimNullable) @IsString() @IsNotEmpty() @MaxLength(150) nombre: string;
  @Transform(trimNullable) @IsString() @IsOptional() @MaxLength(100) cargo?: string | null;
  @Transform(trimNullable) @IsString() @IsOptional() @MaxLength(30) telefono?: string | null;
  @Transform(trimNullable) @IsEmail() @IsOptional() @MaxLength(150) email?: string | null;
  @IsIn(['Telefono', 'WhatsApp', 'Email', 'Otro']) canalPreferido = 'Telefono';
  @IsBoolean() @IsOptional() esPrincipal = false;
  @Transform(trimNullable) @IsString() @IsOptional() @MaxLength(500) notas?: string | null;
}
