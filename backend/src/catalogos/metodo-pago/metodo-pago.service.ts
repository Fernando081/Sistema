// backend/src/catalogos/metodo-pago/metodo-pago.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class MetodoPagoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findAll(): Promise<any[]> {
    return this.dataSource.query('SELECT * FROM fn_get_metodospago()');
  }
}
