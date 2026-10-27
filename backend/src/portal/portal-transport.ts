import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request,Response,CookieOptions } from 'express';
import { browserOrigins, requireBrowserTransport } from '../auth/browser-auth';
export function portalRequest(req:Request){
 requireBrowserTransport(req);
 const origin=req.header('origin');
 if(req.header('x-portal-browser')!=='1'||req.header('sec-fetch-site')==='cross-site'||
  ((!origin&&!['GET','HEAD'].includes(req.method))||(origin&&!browserOrigins().includes(origin))))throw new ForbiddenException('Solicitud del portal no autorizada');
}
export const portalCookieName=()=>process.env.NODE_ENV==='production'?'__Host-portal_session':'portal_session';
const options=():CookieOptions=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:process.env.NODE_ENV==='production'?'/':'/api/v1/portal'});
export function portalCookie(res:Response,value?:string,expires?:Date){if(value)res.cookie(portalCookieName(),value,{...options(),expires});else res.clearCookie(portalCookieName(),options());}
export function portalToken(req:Request){
 const cookies=(req.headers.cookie??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(portalCookieName()+'='));
 if(cookies.length!==1||!/^[-_a-zA-Z0-9]{43}$/.test(cookies[0].slice(portalCookieName().length+1)))throw new UnauthorizedException('Sesión del portal requerida');
 return cookies[0].slice(portalCookieName().length+1);
}
