import { base32,digest,matchingStep,MfaCipher,totp } from './mfa-crypto';
import { randomBytes } from 'node:crypto';

describe('Segundo factor: RFC6238 y cifrado autenticado',()=>{
  const secret=base32(Buffer.from('12345678901234567890'));
  it.each([[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])('vector público RFC en %s',(seconds,expected)=>{
    expect(totp(secret,Number(seconds),8)).toBe(expected);
  });
  it('codifica Base32 sin relleno y respeta ceros iniciales',()=>{expect(base32(Buffer.from('foo'))).toBe('MZXW6');expect(totp(secret,1111111109,8)).toBe('07081804');});
  it('limita ventana y rechaza repetición, formato y fechas fuera de ventana',()=>{
    const seconds=1234567890,step=Math.floor(seconds/30),code=totp(secret,seconds);
    expect(matchingStep(secret,code,seconds,-1)).toBe(step);
    expect(matchingStep(secret,code,seconds,step)).toBeNull();expect(matchingStep(secret,'12345',seconds,-1)).toBeNull();
    expect(matchingStep(secret,totp(secret,seconds-90),seconds,-1)).toBeNull();
    expect(matchingStep(secret,totp(secret,seconds+30),seconds,-1)).toBe(step+1);
  });
  it('cifra con nonce aleatorio, autentica cuenta y detecta manipulación/clave ausente',()=>{
    const previous=process.env.AUTH_MFA_ENCRYPTION_KEY;
    try{process.env.AUTH_MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');const cipher=new MfaCipher(),box=cipher.seal(secret,7);
      expect(cipher.open(box,7)===secret).toBe(true);expect(cipher.seal(secret,7)!==box).toBe(true);expect(box.includes(secret)).toBe(false);
      expect(()=>cipher.open(box,8)).toThrow();const pieces=box.split('.'),changed=Buffer.from(pieces[3],'base64url');changed[0]^=1;pieces[3]=changed.toString('base64url');expect(()=>cipher.open(pieces.join('.'),7)).toThrow();
      delete process.env.AUTH_MFA_ENCRYPTION_KEY;expect(cipher.available()).toBe(false);expect(()=>cipher.open(box,7)).toThrow();expect(digest('public')).toHaveLength(64);
    }finally{if(previous===undefined)delete process.env.AUTH_MFA_ENCRYPTION_KEY;else process.env.AUTH_MFA_ENCRYPTION_KEY=previous;}
  });
});
