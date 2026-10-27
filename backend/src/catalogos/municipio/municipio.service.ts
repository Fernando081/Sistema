import { queryRows } from '../../common/database/typed-query';
import { MunicipioRow } from '../catalogo.types';
// backend/src/catalogos/municipio/municipio.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
@Injectable()
export class MunicipioService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}
  async findByEstado(claveEstado: string): Promise<MunicipioRow[]> {
    return queryRows<MunicipioRow>(this.dataSource,
      'SELECT * FROM fn_get_municipios_por_estado($1)',
      [claveEstado],
    );
  }
}
