import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RecoveryProofDto {
  @IsString() @IsNotEmpty() @MaxLength(256) currentPassword!:string;
  @IsOptional() @IsString() @Matches(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})$/) code?:string;
}
export class RecoveryKeyDto {
  @IsString() @Matches(/^RTT-PWD-[A-Za-z0-9_-]{43}$/) recoveryKey!:string;
}
export class RecoverPasswordDto extends RecoveryKeyDto {
  @IsString() @IsNotEmpty() @MaxLength(100) username!:string;
  @IsString() @MinLength(10) @MaxLength(72) newPassword!:string;
  @IsString() @MinLength(10) @MaxLength(72) confirmation!:string;
  @IsOptional() @IsString() @Matches(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})$/) code?:string;
}
