// backend/src/catalogos/clave-prod-serv/clave-prod-serv.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class ClaveProdServService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async buscar(termino: string): Promise<any[]> {
    if (!termino || termino.length < 3) return [];
    return this.dataSource.query('SELECT * FROM fn_buscar_claveprodserv($1)', [
      termino,
    ]);
  }
}
