import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsBoolean,
  Matches,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RolUsuario } from '../common/enums/app.enums';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(256)
  password!: string;
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^\S+$/, { message: 'El usuario no debe contener espacios' })
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @IsIn([RolUsuario.ADMIN, RolUsuario.USER])
  role?: RolUsuario;
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn([RolUsuario.ADMIN, RolUsuario.USER])
  role?: RolUsuario;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  newPassword!: string;
}

export class UserPermissionDto {
  @IsString() @Matches(/^[a-z][a-z0-9_.]{2,79}$/) permissionCode!: string;
  @IsBoolean() granted!: boolean;
}

export class UpdateUserPermissionsDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({each:true}) @Type(()=>UserPermissionDto)
  permissions!: UserPermissionDto[];

  @IsInt() @Min(0)
  accessVersion!: number;
}
