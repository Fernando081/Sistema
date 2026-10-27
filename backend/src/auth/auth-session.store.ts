import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { AuthUser } from './auth-user.entity';
import { JwtPayload } from './auth.types';
import { setAuditActor } from './audit-actor';

export function sessionClientLabel(userAgent = ''): string {
  const ua=userAgent.slice(0,512);
  const browser=/Edg\//i.test(ua)?'Edge':/OPR\//i.test(ua)?'Opera':/Firefox\//i.test(ua)?'Firefox':
    /(?:Chrome|CriOS)\//i.test(ua)?'Chrome':/Safari\//i.test(ua)?'Safari':'Navegador no identificado';
  const os=/(?:iPhone|iPad)/i.test(ua)?'iOS':/Android/i.test(ua)?'Android':/Windows/i.test(ua)?'Windows':
    /Macintosh|Mac OS X/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':null;
  return os?`${browser} · ${os}`:browser;
}

export interface SessionView {
  idSession: string;
  clientLabel: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
}

// Se construye con el mismo manager del repositorio AuthUser, incluidos verificadores aislados.
export class AuthSessionStore {
  constructor(private readonly source: EntityManager) {}

  async create(user: AuthUser, expires: number, userAgent?: string): Promise<string> {
    const id=randomUUID();
    await this.source.transaction(async manager=>{
      const rows=await queryRows(manager,`SELECT id_user FROM auth_user WHERE id_user=$1 AND is_active
        AND token_version=$2 AND role=$3 AND password_hash=$4 FOR UPDATE`,[user.idUser,user.tokenVersion,user.role,user.passwordHash]);
      if(!rows.length)throw new UnauthorizedException('La cuenta cambió durante el inicio de sesión. Intenta nuevamente.');
      await manager.query(`DELETE FROM auth_session WHERE id_user=$1 AND expires_at<clock_timestamp()
        AND created_at<clock_timestamp()-interval '30 days'`,[user.idUser]);
      await manager.query(`INSERT INTO auth_session(id_session,id_user,token_version,client_label,expires_at)
        VALUES($1,$2,$3,$4,to_timestamp($5))`,[id,user.idUser,user.tokenVersion,sessionClientLabel(userAgent),expires]);
      // Límite de veinte logins activos por cuenta. La fila de usuario serializa logins simultáneos.
      await manager.query(`UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id_session IN (
        SELECT id_session FROM auth_session WHERE id_user=$1 AND token_version=$2 AND revoked_at IS NULL
        AND expires_at>clock_timestamp() AND id_session<>$3 ORDER BY created_at DESC,id_session OFFSET 19)`,[user.idUser,user.tokenVersion,id]);
    });
    return id;
  }

  async validate(actor: JwtPayload) {
    const [row]=await queryRows<{last_seen_at:Date}>(this.source,`SELECT s.last_seen_at FROM auth_session s
      JOIN auth_user u ON u.id_user=s.id_user WHERE s.id_session=$1 AND s.id_user=$2 AND s.token_version=$3
      AND u.is_active AND u.token_version=s.token_version AND u.role=$4 AND u.username=$5
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,[actor.sid,actor.idUser,actor.version,actor.role,actor.sub]);
    if(!row)throw new UnauthorizedException('La sesión fue cerrada o venció. Inicia sesión nuevamente.');
    if(new Date(row.last_seen_at).getTime()<Date.now()-60000)await this.source.query(`UPDATE auth_session
      SET last_seen_at=clock_timestamp() WHERE id_session=$1 AND revoked_at IS NULL
      AND last_seen_at<clock_timestamp()-interval '1 minute'`,[actor.sid]);
  }

  list(actor: JwtPayload) {
    this.requirePersisted(actor);
    return queryRows<SessionView>(this.source,`SELECT s.id_session AS "idSession",s.client_label AS "clientLabel",
      s.created_at AS "createdAt",s.last_seen_at AS "lastSeenAt",s.expires_at AS "expiresAt",s.id_session=$2::uuid AS current
      FROM auth_session s JOIN auth_user u ON u.id_user=s.id_user
      WHERE s.id_user=$1 AND s.token_version=u.token_version AND u.is_active AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() ORDER BY (s.id_session=$2::uuid) DESC,s.created_at DESC,s.id_session LIMIT 20`,[actor.idUser,actor.sid]);
  }

  async revoke(actor: JwtPayload, id: string) {
    this.requirePersisted(actor);
    const rows=await queryRows(this.source,`WITH revoked AS (
      UPDATE auth_session SET revoked_at=COALESCE(revoked_at,clock_timestamp())
      WHERE id_session=$1 AND id_user=$2 RETURNING id_session
      ) SELECT id_session FROM revoked`,[id,actor.idUser]);
    if(!rows.length)throw new NotFoundException('Sesión no encontrada');
    return {message:'Sesión cerrada',current:id.toLowerCase()===actor.sid?.toLowerCase()};
  }

  async revokeAll(actor: JwtPayload) {
    this.requirePersisted(actor);
    await this.source.transaction(async manager=>{
      await setAuditActor(manager,actor.idUser);
      await manager.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[actor.idUser]);
      await manager.query('UPDATE auth_session SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id_user=$1 AND revoked_at IS NULL',[actor.idUser]);
    });
    return {message:'Todas las sesiones cerradas'};
  }

  private requirePersisted(actor: JwtPayload) {
    if(!actor.idUser||!actor.sid)throw new BadRequestException('Registra una cuenta persistida para administrar sus sesiones');
  }
}
