import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { AccessProfileDto, AssignAccessProfileDto, UpdateAccessProfileDto } from './access-profile.dto';
import { JwtPayload } from './auth.types';
import { setAuditActor } from './audit-actor';

export interface AccessProfile {
  idProfile: number;
  name: string;
  description: string;
  version: number;
  permissions: string[];
  assignedUsers: number;
}

@Injectable()
export class AccessProfileService {
  constructor(private readonly source: DataSource) {}

  catalog() {
    return queryRows<{ permissionCode: string; description: string }>(this.source,
      'SELECT code AS "permissionCode", description FROM app_permission ORDER BY code');
  }

  list() {
    return queryRows<AccessProfile>(this.source, `SELECT p.id_profile AS "idProfile",p.name,p.description,p.version,
      ARRAY(SELECT permission_code FROM app_access_profile_permission WHERE id_profile=p.id_profile ORDER BY permission_code) AS permissions,
      (SELECT count(*)::int FROM app_user_access_profile WHERE id_profile=p.id_profile) AS "assignedUsers"
      FROM app_access_profile p ORDER BY lower(p.name),p.id_profile`);
  }

  private async transaction<T>(actor: JwtPayload, work: (manager: EntityManager) => Promise<T>) {
    try {
      return await this.source.transaction(async manager => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext('auth-user-administration'))");
        // Revalida dentro del mismo bloqueo que los cambios de rol/desactivación.
        const rows = await queryRows<{ id_user: number }>(manager, `SELECT id_user FROM auth_user
          WHERE id_user=$1 AND role='admin' AND is_active AND token_version=$2 FOR UPDATE`, [actor.idUser,actor.version]);
        if (!rows.length) throw new ForbiddenException('Inicia sesión con un administrador vigente');
        await setAuditActor(manager,actor.idUser);
        return work(manager);
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new ConflictException('Ya existe un perfil con ese nombre');
      }
      throw error;
    }
  }

  private async permissions(manager: EntityManager, codes: string[]) {
    const valid = await queryRows<{ code: string }>(manager,
      'SELECT code FROM app_permission WHERE code=ANY($1::text[])', [codes]);
    if (new Set(codes).size !== codes.length || valid.length !== codes.length) {
      throw new BadRequestException('La lista contiene permisos repetidos o desconocidos');
    }
  }

  async create(body: AccessProfileDto, actor: JwtPayload) {
    return this.transaction(actor, async manager => {
      await this.permissions(manager,body.permissions);
      const [row] = await queryRows<{ idProfile: number }>(manager, `INSERT INTO app_access_profile(name,description)
        VALUES($1,$2) RETURNING id_profile AS "idProfile"`, [body.name.trim(),body.description.trim()]);
      await manager.query(`INSERT INTO app_access_profile_permission SELECT $1,unnest($2::text[])`,[row.idProfile,body.permissions]);
      return { ...row, version: 1 };
    });
  }

  async update(id: number, body: UpdateAccessProfileDto, actor: JwtPayload) {
    return this.transaction(actor,async manager => {
      await this.lockProfile(manager,id,body.version);
      await this.permissions(manager,body.permissions);
      await manager.query(`UPDATE app_access_profile SET name=$2,description=$3,version=version+1,updated_at=clock_timestamp()
        WHERE id_profile=$1`,[id,body.name.trim(),body.description.trim()]);
      await manager.query('DELETE FROM app_access_profile_permission WHERE id_profile=$1',[id]);
      await manager.query('INSERT INTO app_access_profile_permission SELECT $1,unnest($2::text[])',[id,body.permissions]);
      await manager.query(`UPDATE auth_user SET token_version=token_version+1 WHERE id_user IN
        (SELECT id_user FROM app_user_access_profile WHERE id_profile=$1)`,[id]);
      return { idProfile: id, version: body.version+1 };
    });
  }

  async remove(id: number, version: number, actor: JwtPayload) {
    return this.transaction(actor,async manager => {
      await this.lockProfile(manager,id,version);
      const assigned = await queryRows(manager,'SELECT id_user FROM app_user_access_profile WHERE id_profile=$1 LIMIT 1',[id]);
      if (assigned.length) throw new ConflictException('Reasigna a los usuarios antes de eliminar este perfil');
      await manager.query('DELETE FROM app_access_profile WHERE id_profile=$1',[id]);
      return { message: 'Perfil eliminado' };
    });
  }

  private async lockProfile(manager: EntityManager, id: number, version?: number) {
    const [row] = await queryRows<{ version: number }>(manager,
      'SELECT version FROM app_access_profile WHERE id_profile=$1 FOR UPDATE',[id]);
    if (!row) throw new NotFoundException('Perfil no encontrado');
    if (version !== undefined && row.version !== version) throw new ConflictException('El perfil cambió; recarga antes de guardar');
  }

  async assign(id: number, body: AssignAccessProfileDto, actor: JwtPayload) {
    return this.transaction(actor,async manager => {
      const [user] = await queryRows<{ role: string; token_version: number }>(manager,
        'SELECT role,token_version FROM auth_user WHERE id_user=$1 FOR UPDATE',[id]);
      if (!user) throw new NotFoundException('Usuario no encontrado');
      if (user.role !== 'user') throw new BadRequestException('Los perfiles personalizados se asignan a operadores');
      if (user.token_version !== body.accessVersion) throw new ConflictException('El acceso del usuario cambió; recarga antes de asignar');
      if (body.idProfile !== null) await this.lockProfile(manager,body.idProfile);
      const [current] = await queryRows<{ id_profile: number }>(manager,
        'SELECT id_profile FROM app_user_access_profile WHERE id_user=$1',[id]);
      if ((current?.id_profile ?? null) === body.idProfile) return { message: 'El usuario ya tiene ese perfil' };
      await manager.query('DELETE FROM app_user_access_profile WHERE id_user=$1',[id]);
      if (body.idProfile !== null) await manager.query('INSERT INTO app_user_access_profile VALUES($1,$2)',[id,body.idProfile]);
      await manager.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[id]);
      return { message: 'Perfil asignado; sesiones revocadas. Las excepciones individuales se conservan.' };
    });
  }
}
