// backend/src/catalogos/clave-unidad/clave-unidad.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class ClaveUnidadService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async buscar(termino: string): Promise<any[]> {
    if (!termino || termino.length < 2) return [];
    return this.dataSource.query('SELECT * FROM fn_buscar_claveunidad($1)', [
      termino,
    ]);
  }
}
