import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { RolUsuario } from '../common/enums/app.enums';
import { QueryExecutor, queryRows } from '../common/database/typed-query';
import { CrmBandejaService } from './crm-bandeja.service';

interface Work {
  id_resultado: string;
  estado: 'Pendiente' | 'EnCurso' | 'Completado' | 'Agotado' | 'Cancelado';
  intentos: number;
  token: string | null;
  version: number;
}
interface Claim { id: string; token: string; }
interface Schedule {
  id_propietario: number; activa: boolean; vigente_desde: Date;
  programada_en: Date; tipo: string; plazo: string;
}
const permission = "is_active AND role='admin' AND fn_effective_permission(id_user,role,'crm.reportes.programar')";

@Injectable()
export class CrmReportesColaService {
  constructor(private readonly source: DataSource, private readonly inbox: CrmBandejaService) {}

  // Invocado en la misma transacción que conserva el Error original.
  async enqueue(db: QueryExecutor, id: string) {
    await db.query(`INSERT INTO crm_reporte_reintento(id_resultado)
      SELECT id_resultado FROM crm_reporte_resultado WHERE id_resultado=$1 AND estado='Error'
      ON CONFLICT(id_resultado) DO NOTHING`, [id]);
  }

  private async schedule(db: QueryExecutor, id: string) {
    const [p] = await queryRows<Schedule>(db, `SELECT p.id_propietario,p.activa,p.vigente_desde,
      r.programada_en,p.tipo,p.plazo FROM crm_reporte_resultado r
      JOIN crm_reporte_programa p ON p.id_programa=r.id_programa
      WHERE r.id_resultado=$1 AND r.estado='Error' FOR UPDATE OF p`, [id]);
    return p;
  }

  private async staff(db: QueryExecutor, actor: JwtPayload) {
    const [user] = await queryRows(db, `SELECT id_user FROM auth_user
      WHERE id_user=$1 AND token_version=$2 AND $3::text='admin' AND ${permission} FOR SHARE`,
    [actor.idUser, actor.version, actor.role]);
    if (!user) throw new ForbiddenException('Tu cuenta o permiso de reportes cambió.');
  }

  private human<T>(program: string, id: string, actor: JwtPayload, work: (db: EntityManager, p: Schedule) => Promise<T>) {
    return this.source.transaction(async db => {
      await db.query("SET LOCAL statement_timeout='10s'");
      const p = await this.schedule(db, id);
      const [belongs] = await queryRows(db, 'SELECT 1 FROM crm_reporte_resultado WHERE id_resultado=$1 AND id_programa=$2', [id, program]);
      if (!p || !belongs || p.id_propietario !== actor.idUser) throw new NotFoundException('Resultado no encontrado.');
      await this.staff(db, actor);
      await setAuditActor(db, actor.idUser);
      return work(db, p);
    });
  }

  request(program: string, id: string, actor: JwtPayload) {
    return this.human(program, id, actor, async (db, p) => {
      if (!p.activa || p.programada_en < p.vigente_desde) throw new ConflictException('La programación cambió o está suspendida.');
      await this.enqueue(db, id);
      return { id };
    });
  }

  cancel(program: string, id: string, version: number, actor: JwtPayload) {
    return this.human(program, id, actor, async db => {
      const [job] = await queryRows<Work>(db, 'SELECT * FROM crm_reporte_reintento WHERE id_resultado=$1 FOR UPDATE', [id]);
      if (!job) throw new NotFoundException('Reintento no encontrado.');
      if (job.estado === 'Cancelado') return { id };
      if (job.version !== version || !['Pendiente', 'EnCurso'].includes(job.estado)) throw new ConflictException('El reintento cambió; actualiza el historial.');
      await this.finish(db, job, 'Cancelado', 'Cancelado', 'CANCELADO_POR_PROPIETARIO');
      return { id };
    });
  }

  private async event(db: QueryExecutor, job: Work, phase: string, code: string | null = null) {
    await db.query('INSERT INTO crm_reporte_intento_evento(id_resultado,intento,fase,codigo) VALUES($1,$2,$3,$4)',
      [job.id_resultado, job.intentos, phase, code]);
  }

  private async finish(db: QueryExecutor, job: Work, state: Work['estado'], phase: string, code: string | null = null) {
    await this.event(db, job, phase, code);
    await db.query(`UPDATE crm_reporte_reintento SET estado=$2,token=NULL,lease_hasta=NULL,version=version+1,
      disponible_en=clock_timestamp()+make_interval(mins=>CASE WHEN intentos=1 THEN 10 ELSE 20 END)
      WHERE id_resultado=$1`, [job.id_resultado, state]);
  }

  private async recoverExpired() {
    await this.source.transaction(async db => {
      await db.query("SET LOCAL statement_timeout='8s'");
      const jobs = await queryRows<Work>(db, `SELECT * FROM crm_reporte_reintento
        WHERE estado='EnCurso' AND lease_hasta<=clock_timestamp() ORDER BY lease_hasta,id_resultado
        LIMIT 20 FOR UPDATE SKIP LOCKED`);
      for (const job of jobs) await this.finish(db, job, job.intentos >= 3 ? 'Agotado' : 'Pendiente', 'Interrumpido', 'EJECUCION_INTERRUMPIDA');
    });
  }

  private claim(): Promise<Claim | null> {
    return this.source.transaction(async db => {
      await db.query("SET LOCAL statement_timeout='8s'");
      const [job] = await queryRows<Work>(db, `SELECT * FROM crm_reporte_reintento
        WHERE estado='Pendiente' AND intentos<3 AND disponible_en<=clock_timestamp()
        ORDER BY disponible_en,id_resultado LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!job) return null;
      const token = randomUUID();
      await db.query(`UPDATE crm_reporte_reintento SET estado='EnCurso',intentos=intentos+1,
        token=$2,lease_hasta=clock_timestamp()+interval '5 minutes',version=version+1 WHERE id_resultado=$1`, [job.id_resultado, token]);
      await this.event(db, { ...job, intentos: job.intentos + 1 }, 'Inicio');
      return { id: job.id_resultado, token };
    });
  }

  private async current(db: QueryExecutor, claim: Claim) {
    const [job] = await queryRows<Work>(db, `SELECT * FROM crm_reporte_reintento
      WHERE id_resultado=$1 AND token=$2 AND estado='EnCurso' AND lease_hasta>clock_timestamp() FOR UPDATE`, [claim.id, claim.token]);
    return job;
  }

  private execute(claim: Claim) {
    // READ COMMITTED revalida permisos después de esperar bloqueos. Todos los
    // conteos/corte provienen de una sola sentencia de Bandeja, sin lecturas parciales.
    return this.source.transaction(async db => {
      await db.query("SET LOCAL statement_timeout='10s'");
      const p = await this.schedule(db, claim.id);
      const job = await this.current(db, claim);
      if (!job) return;
      const [user] = p ? await queryRows<{ version: number }>(db,
        `SELECT token_version AS version FROM auth_user WHERE id_user=$1 AND ${permission} FOR SHARE`, [p.id_propietario]) : [];
      if (!p || !p.activa || p.programada_en < p.vigente_desde || !user) {
        await this.finish(db, job, 'Cancelado', 'Cancelado', 'AUTORIZACION_O_CONFIGURACION');
        return;
      }
      const actor: JwtPayload = { idUser: p.id_propietario, role: RolUsuario.ADMIN, version: user.version,
        sub: 'queued-report', iat: 0, exp: 0, iss: 'sistema-erp', aud: 'sistema-web' };
      const r = await this.inbox.inSnapshot({ page: 1, q: '', tipo: p.tipo, plazo: p.plazo }, actor, db);
      const snapshot = { version: 1, consultadoEn: r.consultadoEn, zonaHoraria: r.zonaHoraria,
        tipo: p.tipo, plazo: p.plazo, total: r.total, resumen: r.resumen };
      await db.query('INSERT INTO crm_reporte_recuperacion(id_resultado,token,snapshot) VALUES($1,$2,$3::jsonb)', [claim.id, claim.token, JSON.stringify(snapshot)]);
      await this.finish(db, job, 'Completado', 'Generado');
    });
  }

  async processDue() {
    await this.recoverExpired();
    let failed = false;
    for (let n = 0; n < 20; n++) {
      const claim = await this.claim();
      if (!claim) break;
      try { await this.execute(claim); }
      catch {
        failed = true;
        await this.source.transaction(async db => {
          await db.query("SET LOCAL statement_timeout='8s'");
          const job = await this.current(db, claim);
          if (job) await this.finish(db, job, job.intentos >= 3 ? 'Agotado' : 'Pendiente', 'Error', 'GENERACION_FALLIDA');
        });
      }
    }
    if (failed) throw new Error('Hay reintentos de reportes fallidos.');
  }
}
