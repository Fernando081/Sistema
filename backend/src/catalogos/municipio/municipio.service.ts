// backend/src/catalogos/municipio/municipio.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class MunicipioService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findByEstado(claveEstado: string): Promise<any[]> {
    return this.dataSource.query(
      'SELECT * FROM fn_get_municipios_por_estado($1)',
      [claveEstado],
    );
  }
}
