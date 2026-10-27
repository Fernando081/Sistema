import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthUser } from './auth-user.entity';
import { AuthService } from './auth.service';
import { PasswordRecoveryService } from './password-recovery.service';
import { digest } from './mfa-crypto';
import { validatePasswordPolicy } from './password-policy';

describe('Recuperación de contraseña sin enumerar cuentas',()=>{
  const key='RTT-PWD-'+ 'a'.repeat(43),input={username:'fixture',recoveryKey:key,newPassword:'a-new-password',confirmation:'a-new-password'};
  const actor={idUser:7,version:2} as Parameters<PasswordRecoveryService['status']>[0];
  let service:PasswordRecoveryService,query:jest.Mock,verify:jest.Mock;
  beforeEach(()=>{
    query=jest.fn().mockResolvedValue([]);verify=jest.fn().mockResolvedValue(false);
    const manager={query,transaction:jest.fn(work=>work(manager))};
    service=new PasswordRecoveryService({manager} as unknown as Repository<AuthUser>,{mfa:{verifyAccountFactor:verify}} as unknown as AuthService);
  });
  it.each([undefined,{is_active:false},{is_active:true,active_hash:null},{is_active:true,active_hash:digest(key),expires_at:new Date(1)},
    {is_active:true,active_hash:digest(key),expires_at:new Date(Date.now()+3600000),credential_digest:'outdated',password_hash:'fixture'}])('mismo rechazo genérico sin alterar cuenta/consumir MFA (%s)',async row=>{
    query.mockResolvedValue(row?[row]:[]);let message='';
    try{await service.recover(input);}catch(error){expect(error).toBeInstanceOf(BadRequestException);message=(error as Error).message;}
    expect(message).toBe('No fue posible recuperar la cuenta. Revisa tus datos, la vigencia de la clave y el segundo factor si lo tienes activado.');
    expect(query).toHaveBeenCalledTimes(1);expect(verify).not.toHaveBeenCalled();
  });
  it('no acepta nueva contraseña dispareja ni multibyte truncada por bcrypt',async()=>{
    await expect(service.recover({...input,confirmation:'different-new-password'})).rejects.toThrow('no coinciden');
    await expect(service.recover({...input,newPassword:'ñ'.repeat(37),confirmation:'ñ'.repeat(37)})).rejects.toThrow('72 bytes');
    expect(query).not.toHaveBeenCalled();expect(()=>validatePasswordPolicy('ñ'.repeat(36))).not.toThrow();
  });
  it('clave válida no permite omitir MFA y no cambia contraseña al fallar el factor',async()=>{
    query.mockResolvedValue([{id_user:7,is_active:true,active_hash:digest(key),credential_digest:digest('fixture'),password_hash:'fixture',expires_at:new Date(Date.now()+3600000)}]);
    await expect(service.recover(input)).rejects.toThrow(BadRequestException);
    expect(verify).toHaveBeenCalledWith(expect.anything(),7,undefined);expect(query).toHaveBeenCalledTimes(1);
  });
  it('estado público no devuelve hashes, clave o credencial',async()=>{
    query.mockResolvedValue([{active_hash:digest(key),credential_digest:digest('fixture'),password_hash:'fixture',expires_at:new Date(Date.now()+3600000),confirmed_at:new Date(),pending_hash:null}]);
    expect(Object.keys(await service.status(actor)).sort()).toEqual(['configured','confirmedAt','expiresAt','pending']);
  });
  it('sesión obsoleta no puede emitir claves',async()=>{await expect(service.begin(actor,{currentPassword:'fixture-password'})).rejects.toThrow(UnauthorizedException);expect(verify).not.toHaveBeenCalled();});
  it('un pendiente de una sesión revocada no aparece como confirmable',async()=>{
    const row={password_hash:'fixture',pending_hash:digest(key),pending_credential_digest:digest('fixture'),pending_expires_at:new Date(Date.now()+60000),pending_version:1};
    query.mockResolvedValue([row]);expect((await service.status(actor)).pending).toBe(false);
    query.mockResolvedValue([{...row,pending_version:2}]);expect((await service.status(actor)).pending).toBe(true);
  });
});
