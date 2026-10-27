import { queryRows } from '../../common/database/typed-query';
import { FormaPagoRow } from '../catalogo.types';
// backend/src/catalogos/forma-pago/forma-pago.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class FormaPagoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findAll(): Promise<FormaPagoRow[]> {
    return queryRows<FormaPagoRow>(this.dataSource, 'SELECT * FROM fn_get_formaspago()');
  }
}
