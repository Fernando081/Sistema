import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { EntityManager, Repository } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-user.entity';
import { JwtPayload } from './auth.types';
import { digest } from './mfa-crypto';
import { validatePasswordPolicy } from './password-policy';
import { RecoverPasswordDto, RecoveryProofDto } from './password-recovery.dto';
import { setAuditActor } from './audit-actor';

interface Owner {id_user:number;password_hash:string;token_version:number;is_active:boolean}
interface RecoveryRow {
  active_hash:string|null;credential_digest:string|null;confirmed_at:Date|null;expires_at:Date|null;
  pending_hash:string|null;pending_credential_digest:string|null;pending_version:number|null;pending_expires_at:Date|null;
}
const invalidRecovery='No fue posible recuperar la cuenta. Revisa tus datos, la vigencia de la clave y el segundo factor si lo tienes activado.';
function equalHash(left:string|null,right:string){return timingSafeEqual(Buffer.from(left??'0'.repeat(64)),Buffer.from(right));}

@Injectable()
export class PasswordRecoveryService {
  constructor(@InjectRepository(AuthUser) private readonly users:Repository<AuthUser>,private readonly auth:AuthService){}

  async status(actor:JwtPayload){
    const [row]=await queryRows<RecoveryRow&{password_hash:string}>(this.users.manager,`SELECT r.*,u.password_hash FROM auth_user u
      LEFT JOIN auth_password_recovery r ON r.id_user=u.id_user WHERE u.id_user=$1 AND u.is_active AND u.token_version=$2`,[actor.idUser,actor.version]);
    if(!row)throw new UnauthorizedException('Inicia sesión nuevamente.');
    return {configured:Boolean(row.active_hash&&row.expires_at&&new Date(row.expires_at).getTime()>Date.now()&&row.credential_digest===digest(row.password_hash)),
      confirmedAt:row.confirmed_at,expiresAt:row.expires_at,pending:Boolean(row.pending_hash&&row.pending_expires_at&&new Date(row.pending_expires_at).getTime()>Date.now()
        &&row.pending_version===actor.version&&row.pending_credential_digest===digest(row.password_hash))};
  }

  async begin(actor:JwtPayload,body:RecoveryProofDto){
    const result=await this.users.manager.transaction(async manager=>{
      const user=await this.owner(manager,actor,body.currentPassword);
      if(!await this.auth.mfa.verifyAccountFactor(manager,user.id_user,body.code))return null;
      const key='RTT-PWD-'+randomBytes(32).toString('base64url');
      await manager.query(`INSERT INTO auth_password_recovery(id_user,pending_hash,pending_credential_digest,pending_version,pending_expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes') ON CONFLICT(id_user) DO UPDATE SET pending_hash=EXCLUDED.pending_hash,
        pending_credential_digest=EXCLUDED.pending_credential_digest,pending_version=EXCLUDED.pending_version,pending_expires_at=EXCLUDED.pending_expires_at`,
      [user.id_user,digest(key),digest(user.password_hash),user.token_version]);
      return {recoveryKey:key,expiresIn:600,validityDays:365};
    });
    if(!result)throw new BadRequestException('Se necesita un segundo factor válido y no utilizado. Si hubo varios fallos, espera diez minutos.');return result;
  }

  async confirm(actor:JwtPayload,key:string){
    await this.users.manager.transaction(async manager=>{
      const user=await this.owner(manager,actor),[row]=await queryRows<RecoveryRow>(manager,'SELECT * FROM auth_password_recovery WHERE id_user=$1 FOR UPDATE',[user.id_user]);
      if(!row||!equalHash(row.pending_hash,digest(key))||!row.pending_expires_at||new Date(row.pending_expires_at).getTime()<=Date.now()
        ||row.pending_version!==user.token_version||row.pending_credential_digest!==digest(user.password_hash))throw new BadRequestException('La clave pendiente es inválida o venció. Genera una nueva.');
      await manager.query(`UPDATE auth_password_recovery SET active_hash=pending_hash,credential_digest=pending_credential_digest,
        confirmed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days',pending_hash=NULL,pending_credential_digest=NULL,
        pending_version=NULL,pending_expires_at=NULL WHERE id_user=$1`,[user.id_user]);
      await this.notify(manager,user.id_user,'configured','Clave de recuperación configurada','Se confirmó una nueva clave offline para recuperar tu contraseña. La anterior dejó de funcionar. Si no fuiste tú, revisa tu cuenta.');
    });return {message:'Clave de recuperación confirmada. Guárdala fuera del sistema.'};
  }

  async revoke(actor:JwtPayload,body:RecoveryProofDto){
    const result=await this.users.manager.transaction(async manager=>{
      const user=await this.owner(manager,actor,body.currentPassword);
      if(!await this.auth.mfa.verifyAccountFactor(manager,user.id_user,body.code))return false;
      const rows=await queryRows(manager,`WITH removed AS (DELETE FROM auth_password_recovery WHERE id_user=$1 RETURNING id_user) SELECT id_user FROM removed`,[user.id_user]);
      if(rows.length)await this.notify(manager,user.id_user,'revoked','Clave de recuperación retirada','Se retiró la clave offline para recuperar tu contraseña. Puedes configurar otra desde Mi cuenta.');return true;
    });if(!result)throw new BadRequestException('Se necesita un segundo factor válido y no utilizado.');return {message:'Clave de recuperación retirada.'};
  }

  async recover(body:RecoverPasswordDto){
    validatePasswordPolicy(body.newPassword);if(body.newPassword!==body.confirmation)throw new BadRequestException('Las contraseñas nuevas no coinciden.');
    // Mismo trabajo bcrypt para usuario desconocido, clave incorrecta, cuenta inactiva y éxito.
    // No se bloquea una cuenta ni se consume su clave al presentar datos desconocidos.
    const newHash=await AuthService.hashPassword(body.newPassword);
    const ok=await this.users.manager.transaction(async manager=>{
      const [user]=await queryRows<Owner&RecoveryRow>(manager,`SELECT r.*,u.id_user,u.password_hash,u.token_version,u.is_active
        FROM auth_user u LEFT JOIN auth_password_recovery r ON r.id_user=u.id_user WHERE u.username=$1 FOR UPDATE OF u`,[body.username.trim()]);
      if(!user||!user.is_active||!equalHash(user.active_hash,digest(body.recoveryKey))||!user.expires_at||new Date(user.expires_at).getTime()<=Date.now()
        ||user.credential_digest!==digest(user.password_hash))return false;
      if(!await this.auth.mfa.verifyAccountFactor(manager,user.id_user,body.code))return false;
      await setAuditActor(manager,user.id_user);
      await manager.query('UPDATE auth_user SET password_hash=$2,token_version=token_version+1 WHERE id_user=$1',[user.id_user,newHash]);
      await manager.query('UPDATE auth_session SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id_user=$1',[user.id_user]);
      await manager.query('DELETE FROM auth_mfa_challenge WHERE id_user=$1',[user.id_user]);
      await manager.query('DELETE FROM auth_password_recovery WHERE id_user=$1',[user.id_user]);
      await this.notify(manager,user.id_user,'completed','Contraseña recuperada','Se recuperó tu contraseña con la clave offline. Se cerraron todas tus sesiones y se consumió la clave. Revisa tus factores y genera otra clave. Si no fuiste tú, avisa al propietario.');
      return true;
    });
    if(!ok)throw new BadRequestException(invalidRecovery);
    return {message:'Contraseña actualizada. Inicia sesión con tu nueva contraseña y configura otra clave de recuperación.'};
  }

  private async owner(manager:EntityManager,actor:JwtPayload,password?:string){
    if(!actor.idUser)throw new BadRequestException('Se necesita una cuenta persistida.');
    const [user]=await queryRows<Owner>(manager,'SELECT * FROM auth_user WHERE id_user=$1 AND is_active AND token_version=$2 FOR UPDATE',[actor.idUser,actor.version]);
    if(!user)throw new UnauthorizedException('Inicia sesión nuevamente.');
    if(password!==undefined&&!await bcrypt.compare(password,user.password_hash))throw new BadRequestException('Contraseña actual incorrecta.');
    await setAuditActor(manager,actor.idUser);return user;
  }
  private async notify(manager:EntityManager,id:number,event:string,title:string,message:string){
    await manager.query(`INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,dedupe_key)
      VALUES($1,'account_recovery',$2,$3,'warning','/perfil','account_recovery',$4)`,[id,title,message,'account-recovery:'+event+':'+randomUUID()]);
  }
}
