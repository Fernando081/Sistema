import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class AuditoriaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll() {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT a.*, u.username AS app_username
        FROM auditoria_jsonb a
        LEFT JOIN auth_user u ON u.id_user = a.app_user_id
       ORDER BY a.timestamp DESC
       LIMIT 500
    `);
  }
}
