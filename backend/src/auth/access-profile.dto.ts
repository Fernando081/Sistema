import { IsArray, IsInt, IsString, Matches, MaxLength, Min, ValidateIf, ArrayMaxSize, ArrayUnique } from 'class-validator';

export class AccessProfileDto {
  @IsString() @MaxLength(80) @Matches(/\S/, { message: 'Escribe el nombre del perfil' })
  name!: string;

  @IsString() @MaxLength(500)
  description!: string;

  @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9_.]{2,79}$/, { each: true })
  permissions!: string[];
}

export class AccessVersionDto {
  @IsInt() @Min(1)
  version!: number;
}

export class UpdateAccessProfileDto extends AccessProfileDto {
  @IsInt() @Min(1)
  version!: number;
}

export class AssignAccessProfileDto {
  @ValidateIf((_object, value: unknown) => value !== null) @IsInt() @Min(1)
  idProfile!: number | null;

  @IsInt() @Min(0)
  accessVersion!: number;
}
