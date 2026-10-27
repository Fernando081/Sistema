import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { browserCookieName, browserCookieOptions, browserOrigins, browserToken, requireBrowserRequest } from './browser-auth';

describe('Transporte navegador y protección de origen',()=>{
  const saved={NODE_ENV:process.env.NODE_ENV,CORS_ORIGINS:process.env.CORS_ORIGINS};
  const req=(headers:Record<string,string>={},secure=false,remoteAddress='127.0.0.1')=>({
    headers,header:(key:string)=>headers[key],secure,socket:{remoteAddress},
  }) as unknown as Request;
  beforeEach(()=>{process.env.NODE_ENV='test';delete process.env.CORS_ORIGINS;});
  afterAll(()=>{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  it('exige origen exacto y cabecera no simple para operaciones del navegador',()=>{
    const headers={'x-erp-browser':'1',origin:'http://127.0.0.1:4300'};
    expect(()=>requireBrowserRequest(req(headers))).not.toThrow();
    for(const bad of [{origin:headers.origin},{'x-erp-browser':'1'},{...headers,origin:'null'},
      {...headers,origin:'http://127.0.0.1:4300.evil.test'}, {...headers,'sec-fetch-site':'cross-site'}]){
      expect(()=>requireBrowserRequest(req(bad))).toThrow(ForbiddenException);
    }
  });
  it('GET de identidad exige cabecera y rechaza origen externo aunque solo lea',()=>{
    expect(()=>requireBrowserRequest(req({'x-erp-browser':'1'}),true)).not.toThrow();
    expect(()=>requireBrowserRequest(req({'x-erp-browser':'1',origin:'http://evil.test'}),true)).toThrow(ForbiddenException);
    expect(()=>requireBrowserRequest(req(),true)).toThrow(ForbiddenException);
  });
  it('HTTP de desarrollo se limita a loopback',()=>{
    expect(()=>requireBrowserRequest(req({'x-erp-browser':'1',origin:'http://127.0.0.1:4300'},false,'192.168.1.4'))).toThrow(BadRequestException);
  });
  it('cookies HttpOnly/Strict sin dominio; Secure y prefijo Host en producción',()=>{
    expect(browserCookieOptions()).toMatchObject({httpOnly:true,sameSite:'strict',secure:false,path:'/api/v1'});
    process.env.NODE_ENV='production';
    expect(browserCookieName()).toBe('__Host-erp_session');
    expect(browserCookieOptions()).toEqual({httpOnly:true,sameSite:'strict',secure:true,path:'/'});
  });
  it('producción exige HTTPS y lista explícita, sin confiar en X-Forwarded-Proto por sí sola',()=>{
    process.env.NODE_ENV='production';expect(()=>browserOrigins()).toThrow();
    process.env.CORS_ORIGINS='http://erp.example.test';expect(()=>browserOrigins()).toThrow();
    process.env.CORS_ORIGINS='https://erp.example.test';
    const headers={'x-erp-browser':'1',origin:'https://erp.example.test','x-forwarded-proto':'https'};
    expect(()=>requireBrowserRequest(req(headers))).toThrow(BadRequestException);
    expect(()=>requireBrowserRequest(req(headers,true))).not.toThrow();
    for(const invalid of ['*','null','https://erp.example.test/path','https://u:p@erp.example.test']){
      process.env.CORS_ORIGINS=invalid;expect(()=>browserOrigins()).toThrow();
    }
  });
  it('no acepta cookies ambiguas ni credenciales con nombres parecidos',()=>{
    expect(browserToken(req({cookie:'other=abc; erp_session=fixture.value.sig'}))).toBe('fixture.value.sig');
    expect(browserToken(req({cookie:'not_erp_session=fixture'}))).toBeNull();
    expect(()=>browserToken(req({cookie:'erp_session=one; erp_session=two'}))).toThrow(UnauthorizedException);
  });
});
