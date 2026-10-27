import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class AuditoriaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll() {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT a.*, COALESCE(a.actor_name,u.username) AS app_username
        FROM auditoria_jsonb a
        LEFT JOIN auth_user u ON u.id_user = a.app_user_id
       ORDER BY a.timestamp DESC,a.id DESC
       LIMIT 500
    `);
  }

  async protection(){
    const [row]=await queryRows<{appendOnly:boolean;actorSnapshots:boolean;accessTables:number;privilegedDatabaseRole:boolean}>(this.dataSource,`
      SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auditoria_jsonb'::regclass AND tgname='trg_audit_append_only'
        AND tgenabled='A' AND tgtype=58 AND tgfoid='fn_audit_append_only()'::regprocedure) AS "appendOnly",
        EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auditoria_jsonb'::regclass AND tgname='trg_audit_enrich'
        AND tgenabled='A' AND tgtype=7 AND tgfoid='fn_audit_enrich()'::regprocedure) AS "actorSnapshots",
        (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='trg_access_audit'
          AND c.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid='auditoria_jsonb'::regclass)
          AND c.relname IN ('auth_user','app_permission','app_role_permission','app_user_permission','app_access_profile',
            'app_access_profile_permission','app_user_access_profile') AND t.tgenabled IN ('A','O')
          AND t.tgtype=29 AND t.tgfoid='fn_audit_trigger()'::regprocedure) AS "accessTables",
        (SELECT r.rolsuper OR pg_has_role(current_user,c.relowner,'USAGE') FROM pg_roles r CROSS JOIN pg_class c
          WHERE r.rolname=current_user AND c.oid='auditoria_jsonb'::regclass) AS "privilegedDatabaseRole"`);
    return {...row,expectedAccessTables:7,newEventVersion:1,legacyLimit:500};
  }
}
