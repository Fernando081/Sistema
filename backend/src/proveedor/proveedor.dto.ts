// backend/src/proveedor/proveedor.dto.ts (NUEVO ARCHIVO)

import { IsString, IsNotEmpty, MaxLength, IsOptional, IsInt, MinLength, IsPostalCode } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

// DTO para Crear un Proveedor (Validación)
export class CreateProveedorDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(13)
  rfc: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  razonSocial: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  pais: string;

  @IsInt()
  @IsOptional()
  idEstado: number;

  @IsInt()
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
  @IsOptional()
  idMetodoDePago: number;

  @IsInt()
  @IsOptional()
  idUsoCFDI: number;

  @IsInt()
  @IsOptional()
  idFormaPago: number;

  @IsInt()
  @IsNotEmpty()
  idRegimenFiscal: number;
}

// DTO para Actualizar (la mayoría de campos son opcionales)
export class UpdateProveedorDto extends PartialType(CreateProveedorDto) {}