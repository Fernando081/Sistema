// backend/src/proveedor/proveedor.dto.ts (NUEVO ARCHIVO)

import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  MinLength,
  IsPostalCode,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, TransformFnParams } from 'class-transformer';

// DTO para Crear un Proveedor (Validación)
export class CreateProveedorDto {
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
}

// DTO para Actualizar (la mayoría de campos son opcionales)
export class UpdateProveedorDto extends PartialType(CreateProveedorDto, { skipNullProperties: false }) {}
