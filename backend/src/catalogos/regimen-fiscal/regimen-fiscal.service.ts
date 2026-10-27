import { queryRows } from '../../common/database/typed-query';
import { RegimenFiscalRow } from '../catalogo.types';
// backend/src/catalogos/regimen-fiscal/regimen-fiscal.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class RegimenFiscalService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findAll(): Promise<RegimenFiscalRow[]> {
    return queryRows<RegimenFiscalRow>(this.dataSource, 'SELECT * FROM fn_get_regimenesfiscales()');
  }
}
