import { queryRows } from '../../common/database/typed-query';
import { ClaveProdServRow } from '../catalogo.types';
// backend/src/catalogos/clave-prod-serv/clave-prod-serv.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class ClaveProdServService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async buscar(termino: string): Promise<ClaveProdServRow[]> {
    if (!termino || termino.length < 3) return [];
    return queryRows<ClaveProdServRow>(this.dataSource, 'SELECT * FROM fn_buscar_claveprodserv($1) LIMIT 50', [
      termino,
    ]);
  }
}
