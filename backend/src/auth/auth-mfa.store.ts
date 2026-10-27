import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { AuthUser } from './auth-user.entity';
import { JwtPayload } from './auth.types';
import { base32, digest, matchingStep, MfaCipher, normalizeRecovery } from './mfa-crypto';
import { setAuditActor } from './audit-actor';

interface MfaRow {secret_box:string;enabled_at:Date|null;pending_expires_at:Date;last_step:string;failures:number;blocked_until:Date|null}
interface Challenge {id_user:number;token_version:number;expires_at:Date;consumed_at:Date|null}

export class AuthMfaStore {
  private readonly cipher=new MfaCipher();
  constructor(private readonly source:EntityManager){}

  async status(actor:JwtPayload){
    const [row]=await queryRows<{enabled:boolean;remaining:number}>(this.source,`SELECT m.enabled_at IS NOT NULL enabled,
      (SELECT count(*)::int FROM auth_mfa_recovery r WHERE r.id_user=m.id_user AND used_at IS NULL) remaining
      FROM auth_mfa m WHERE id_user=$1`,[actor.idUser]);
    return {enabled:row?.enabled??false,recoveryCodesRemaining:row?.remaining??0,available:this.cipher.available()};
  }

  async begin(actor:JwtPayload,password:string){
    if(!actor.idUser)throw new BadRequestException('Se necesita una cuenta persistida');
    return this.source.transaction(async manager=>{
      await this.owner(manager,actor,password);
      const row=await this.row(manager,actor.idUser!);
      if(row?.enabled_at)throw new ConflictException('La verificación en dos pasos ya está activada.');
      if(row)this.unblocked(row);
      const secret=base32(randomBytes(20)),box=this.cipher.seal(secret,actor.idUser!);
      await manager.query(`INSERT INTO auth_mfa(id_user,secret_box,pending_expires_at) VALUES($1,$2,clock_timestamp()+interval '10 minutes')
        ON CONFLICT(id_user) DO UPDATE SET secret_box=EXCLUDED.secret_box,pending_expires_at=EXCLUDED.pending_expires_at,last_step=-1`,[actor.idUser,box]);
      // El secreto solo se entrega en esta respuesta privada; no se recupera desde status.
      return {secret,expiresIn:600,issuer:'Refacciones Tampico',account:actor.sub};
    });
  }

  async confirm(actor:JwtPayload,code:string){
    const result=await this.source.transaction(async manager=>{
      await this.owner(manager,actor);
      const row=await this.row(manager,actor.idUser!);
      if(!row||row.enabled_at||new Date(row.pending_expires_at).getTime()<=Date.now())throw new BadRequestException('La configuración venció o ya fue confirmada. Inicia nuevamente.');
      if(!await this.proof(manager,actor.idUser!,row,code,false))return null;
      const codes=await this.codes(manager,actor.idUser!);
      await manager.query('UPDATE auth_mfa SET enabled_at=clock_timestamp() WHERE id_user=$1',[actor.idUser]);
      await this.revoke(manager,actor.idUser!);return {recoveryCodes:codes};
    });
    if(!result)throw new BadRequestException('Código inválido o ya utilizado. Espera el siguiente código.');return result;
  }

  async disable(actor:JwtPayload,password:string,code:string){
    const ok=await this.source.transaction(async manager=>{
      await this.owner(manager,actor,password);const row=await this.row(manager,actor.idUser!);
      if(!row?.enabled_at)throw new BadRequestException('La verificación en dos pasos no está activada.');
      if(!await this.proof(manager,actor.idUser!,row,code,true))return false;
      await manager.query('DELETE FROM auth_mfa WHERE id_user=$1',[actor.idUser]);await this.revoke(manager,actor.idUser!);return true;
    });
    if(!ok)throw new BadRequestException('Código inválido o ya utilizado.');return {message:'Verificación en dos pasos desactivada. Inicia sesión nuevamente.'};
  }

  async challenge(user:AuthUser){
    return this.source.transaction(async manager=>{
      const [current]=await queryRows<AuthUser>(manager,`SELECT id_user AS "idUser" FROM auth_user
        WHERE id_user=$1 AND token_version=$2 AND password_hash=$3 AND is_active FOR UPDATE`,[user.idUser,user.tokenVersion,user.passwordHash]);
      if(!current)throw new UnauthorizedException('La cuenta cambió. Inicia sesión nuevamente.');
      const row=await this.row(manager,user.idUser);if(!row?.enabled_at)return null;this.unblocked(row);
      await manager.query('DELETE FROM auth_mfa_challenge WHERE id_user=$1 AND (expires_at<=clock_timestamp() OR consumed_at IS NOT NULL)',[user.idUser]);
      // Un solo reto pendiente por cuenta. Renovarlo no reinicia los intentos del segundo factor.
      await manager.query('DELETE FROM auth_mfa_challenge WHERE id_user=$1',[user.idUser]);
      const token=randomBytes(32).toString('base64url');
      await manager.query(`INSERT INTO auth_mfa_challenge(token_hash,id_user,token_version,expires_at)
        VALUES($1,$2,$3,clock_timestamp()+interval '5 minutes')`,[digest(token),user.idUser,user.tokenVersion]);
      return {mfaRequired:true as const,challenge:token,expiresIn:300};
    });
  }

  async complete(token:string,code:string):Promise<AuthUser>{
    const result=await this.source.transaction(async manager=>{
      const [lookup]=await queryRows<Challenge>(manager,'SELECT * FROM auth_mfa_challenge WHERE token_hash=$1',[digest(token)]);
      if(!lookup)throw new UnauthorizedException('El intento venció. Inicia sesión nuevamente.');
      // Orden fijo de bloqueos: usuario → MFA → reto. Comparte fila de usuario con cambio de contraseña/permisos/sesiones.
      const [user]=await queryRows<AuthUser>(manager,`SELECT id_user AS "idUser",username,password_hash AS "passwordHash",role,
        is_active AS "isActive",token_version AS "tokenVersion" FROM auth_user WHERE id_user=$1 FOR UPDATE`,[lookup.id_user]);
      const row=await this.row(manager,lookup.id_user);
      const [challenge]=await queryRows<Challenge>(manager,'SELECT * FROM auth_mfa_challenge WHERE token_hash=$1 FOR UPDATE',[digest(token)]);
      if(!user?.isActive||!row?.enabled_at||!challenge||challenge.consumed_at||new Date(challenge.expires_at).getTime()<=Date.now()||challenge.token_version!==user.tokenVersion)
        throw new UnauthorizedException('El intento venció. Inicia sesión nuevamente.');
      if(!await this.proof(manager,user.idUser,row,code,true))return null;
      await manager.query('UPDATE auth_mfa_challenge SET consumed_at=clock_timestamp() WHERE token_hash=$1',[digest(token)]);return user;
    });
    if(!result)throw new UnauthorizedException('Código inválido o ya utilizado. Espera el siguiente código o usa un respaldo.');return result;
  }

  private async owner(manager:EntityManager,actor:JwtPayload,password?:string){
    if(!actor.idUser)throw new BadRequestException('Se necesita una cuenta persistida');
    const [row]=await queryRows<{password_hash:string}>(manager,`SELECT password_hash FROM auth_user WHERE id_user=$1
      AND is_active AND token_version=$2 FOR UPDATE`,[actor.idUser,actor.version]);
    if(!row)throw new UnauthorizedException('Inicia sesión nuevamente.');
    if(password!==undefined&&!await bcrypt.compare(password,row.password_hash))throw new BadRequestException('Contraseña actual incorrecta.');
    await setAuditActor(manager,actor.idUser);
  }

  // Uso interno con la fila de usuario ya bloqueada. El llamador acredita primero
  // contraseña actual o clave offline; jamás permite omitir MFA desde recuperación.
  async verifyAccountFactor(manager:EntityManager,id:number,code?:string):Promise<boolean>{
    const row=await this.row(manager,id);if(!row?.enabled_at)return true;
    if(!code||(row.blocked_until&&new Date(row.blocked_until).getTime()>Date.now()))return false;
    return this.proof(manager,id,row,code,true);
  }
  private async row(manager:EntityManager,id:number){return (await queryRows<MfaRow>(manager,'SELECT * FROM auth_mfa WHERE id_user=$1 FOR UPDATE',[id]))[0];}
  private unblocked(row:MfaRow){if(row.blocked_until&&new Date(row.blocked_until).getTime()>Date.now())throw new HttpException('Demasiados códigos incorrectos. Espera diez minutos e inténtalo de nuevo.',429);}
  private async proof(manager:EntityManager,id:number,row:MfaRow,code:string,allowRecovery:boolean){
    this.unblocked(row);
    const step=matchingStep(this.cipher.open(row.secret_box,id),code,Date.now()/1000,Number(row.last_step));
    let recovered=false;
    if(step===null&&allowRecovery&&/^[a-f0-9]{32}$/.test(normalizeRecovery(code))){
      const rows=await queryRows(manager,`WITH used AS (UPDATE auth_mfa_recovery SET used_at=clock_timestamp()
        WHERE id_user=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash) SELECT code_hash FROM used`,[id,digest(normalizeRecovery(code))]);recovered=rows.length===1;
    }
    if(step===null&&!recovered){
      await manager.query(`UPDATE auth_mfa SET failures=CASE WHEN blocked_until<=clock_timestamp() THEN 1 ELSE LEAST(failures+1,5) END,
        blocked_until=CASE WHEN (CASE WHEN blocked_until<=clock_timestamp() THEN 1 ELSE failures+1 END)>=5
          THEN clock_timestamp()+interval '10 minutes' ELSE NULL END WHERE id_user=$1`,[id]);return false;
    }
    await manager.query('UPDATE auth_mfa SET last_step=COALESCE($2,last_step),failures=0,blocked_until=NULL WHERE id_user=$1',[id,step]);return true;
  }
  private async codes(manager:EntityManager,id:number){
    const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').match(/.{8}/g)!.join('-'));
    await manager.query('DELETE FROM auth_mfa_recovery WHERE id_user=$1',[id]);
    for(const code of codes)await manager.query('INSERT INTO auth_mfa_recovery(id_user,code_hash) VALUES($1,$2)',[id,digest(normalizeRecovery(code))]);return codes;
  }
  private async revoke(manager:EntityManager,id:number){
    await manager.query('UPDATE auth_user SET token_version=token_version+1 WHERE id_user=$1',[id]);
    await manager.query('UPDATE auth_session SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id_user=$1',[id]);
    await manager.query('DELETE FROM auth_mfa_challenge WHERE id_user=$1',[id]);
  }
}
