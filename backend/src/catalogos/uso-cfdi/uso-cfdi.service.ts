import { queryRows } from '../../common/database/typed-query';
import { UsoCfdiRow } from '../catalogo.types';
// backend/src/catalogos/uso-cfdi/uso-cfdi.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class UsoCfdiService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findAll(): Promise<UsoCfdiRow[]> {
    return queryRows<UsoCfdiRow>(this.dataSource, 'SELECT * FROM fn_get_usoscfdi()');
  }
}
