import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AuditoriaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll() {
    return this.dataSource.query('SELECT * FROM auditoria_jsonb ORDER BY timestamp DESC LIMIT 500');
  }
}
