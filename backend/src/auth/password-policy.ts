import { BadRequestException } from '@nestjs/common';

export function validatePasswordPolicy(password:string):void {
  if(typeof password!=='string'||password.length<10||Buffer.byteLength(password,'utf8')>72)
    throw new BadRequestException('La contraseña debe tener al menos 10 caracteres y máximo 72 bytes');
}
