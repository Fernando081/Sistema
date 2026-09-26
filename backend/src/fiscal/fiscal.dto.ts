import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class CancelFiscalDocumentDto {
  @IsOptional()
  @IsIn(['01', '02', '03', '04'])
  motivo?: '01' | '02' | '03' | '04';

  @ValidateIf((value: CancelFiscalDocumentDto) => value.motivo === '01' || value.folioSustitucion !== undefined)
  @IsUUID()
  folioSustitucion?: string;
}
