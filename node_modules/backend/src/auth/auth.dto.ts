import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  @IsIn(['admin', 'user'])
  role?: string;
}
