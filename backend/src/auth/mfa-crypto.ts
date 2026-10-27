import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer): string {
  let bits=0,value=0,result='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
  if(bits)result+=alphabet[(value<<(5-bits))&31];return result;
}
function decode(secret:string):Buffer {
  let bits=0,value=0;const result:number[]=[];
  for(const char of secret){const digit=alphabet.indexOf(char);if(digit<0)throw new Error('Base32 inválido');value=(value<<5)|digit;bits+=5;
    if(bits>=8){result.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(result);
}
// RFC6238/RFC4226: HMAC SHA-1, contador de 64 bits; vectores públicos en mfa-crypto.spec.
export function totp(secret:string,seconds:number,digits=6):string {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(seconds/30)));
  const mac=createHmac('sha1',decode(secret)).update(counter).digest(),offset=mac[mac.length-1]&15;
  return ((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).toString().padStart(digits,'0');
}
export function matchingStep(secret:string,code:string,seconds:number,lastStep:number):number|null {
  if(!/^\d{6}$/.test(code))return null;
  const current=Math.floor(seconds/30);let matched:number|null=null;
  for(const step of [current-1,current,current+1])if(step>=0&&step>lastStep&&timingSafeEqual(Buffer.from(totp(secret,step*30)),Buffer.from(code)))matched=step;
  return matched;
}
export const digest=(value:string):string=>createHash('sha256').update(value).digest('hex');
export const normalizeRecovery=(code:string):string=>code.replace(/-/g,'').toLowerCase();

export class MfaCipher {
  private key():Buffer {
    const encoded=process.env.AUTH_MFA_ENCRYPTION_KEY??'';
    if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw new ServiceUnavailableException('Configura la clave de cifrado de verificación en dos pasos en el servidor.');
    return Buffer.from(encoded,'base64');
  }
  available():boolean {try{this.key();return true;}catch{return false;}}
  seal(secret:string,id:number):string {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);cipher.setAAD(Buffer.from('sistema:mfa:v1:'+id));
    const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');
  }
  open(box:string,id:number):string {
    try{const [version,iv,tag,data]=box.split('.');if(version!=='v1'||!iv||!tag||!data)throw new Error();
      const cipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(iv,'base64url'));cipher.setAAD(Buffer.from('sistema:mfa:v1:'+id));
      cipher.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([cipher.update(Buffer.from(data,'base64url')),cipher.final()]).toString('utf8');
    }catch{throw new ServiceUnavailableException('No fue posible verificar el segundo factor. Revisa la configuración del servidor.');}
  }
}
