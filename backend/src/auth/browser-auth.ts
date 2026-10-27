import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

const localOrigins=[4200,4300,4400].flatMap(port=>[`http://localhost:${port}`,`http://127.0.0.1:${port}`]);
export const BROWSER_HEADER='x-erp-browser';
export interface AuthenticatedRequest extends Request { authTransport?: 'cookie'|'bearer' }

export function browserOrigins(): string[] {
  const configured=process.env.CORS_ORIGINS;
  if(process.env.NODE_ENV==='production'&&!configured)throw new Error('Producción requiere CORS_ORIGINS explícito con HTTPS');
  const values=(configured??localOrigins.join(',')).split(',').map(value=>value.trim());
  for(const value of values){
    let parsed:URL;try{parsed=new URL(value);}catch{throw new Error('CORS_ORIGINS contiene un origen inválido');}
    if(parsed.origin!==value||parsed.username||parsed.password||!['http:','https:'].includes(parsed.protocol)||
      (process.env.NODE_ENV==='production'&&parsed.protocol!=='https:'))throw new Error('CORS_ORIGINS debe contener orígenes exactos; HTTPS en producción');
  }
  return [...new Set(values)];
}

export function browserCookieName() { return process.env.NODE_ENV==='production'?'__Host-erp_session':'erp_session'; }
export function browserCookieOptions(): CookieOptions {
  return {httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:process.env.NODE_ENV==='production'?'/':'/api/v1'};
}
export function clearBrowserCookie(response: Response) { response.clearCookie(browserCookieName(),browserCookieOptions()); }
export function setBrowserCookie(response: Response,token: string,expiresAt: number) {
  response.cookie(browserCookieName(),token,{...browserCookieOptions(),expires:new Date(expiresAt*1000)});
}

export function browserToken(request: Request): string|null {
  const matches=(request.headers.cookie??'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(browserCookieName()+'='));
  if(matches.length>1)throw new UnauthorizedException('Cookie de sesión ambigua');
  return matches.length?matches[0].slice(browserCookieName().length+1):null;
}

// Origen exacto + cabecera no simple: los navegadores externos no pueden fabricar
// esta combinación sin superar CORS. No depende solamente de SameSite.
export function requireBrowserRequest(request: Request,readOnly=false) {
  if(request.header(BROWSER_HEADER)!=='1'||request.header('sec-fetch-site')==='cross-site')
    throw new ForbiddenException('Solicitud de navegador no autorizada');
  const origin=request.header('origin');
  if((!origin&&!readOnly)||(origin&&!browserOrigins().includes(origin)))throw new ForbiddenException('Origen no autorizado');
  requireBrowserTransport(request);
}

export function requireBrowserTransport(request: Request) {
  if(process.env.NODE_ENV==='production'&&!request.secure)throw new BadRequestException('El acceso del navegador requiere HTTPS');
  if(process.env.NODE_ENV!=='production'&&!request.secure&&
    !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??''))
    throw new BadRequestException('HTTP de desarrollo solo está habilitado en loopback');
}
