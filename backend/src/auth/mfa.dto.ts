import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class MfaPasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(256) currentPassword!:string;
}
export class MfaCodeDto {
  @IsString() @Matches(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})$/) code!:string;
}
export class CompleteMfaDto extends MfaCodeDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) challenge!:string;
}
export class DisableMfaDto extends MfaCodeDto {
  @IsString() @IsNotEmpty() @MaxLength(256) currentPassword!:string;
}
