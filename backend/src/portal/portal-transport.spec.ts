import { Request } from 'express';
import { portalCookieName,portalRequest,portalToken } from './portal-transport';
describe('Separación de transporte del portal',()=>{
 const saved={env:process.env.NODE_ENV,origins:process.env.CORS_ORIGINS};
 beforeEach(()=>{process.env.NODE_ENV='test';process.env.CORS_ORIGINS='http://127.0.0.1:4300';});
 afterEach(()=>{for(const[key,value]of Object.entries({NODE_ENV:saved.env,CORS_ORIGINS:saved.origins})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const request=(headers:Record<string,string>,method='GET',secure=false)=>({method,secure,headers,header:(key:string)=>headers[key.toLowerCase()],socket:{remoteAddress:'127.0.0.1'}}as unknown as Request);
 it('ignora la cookie del personal y rechaza cookies propias ambiguas',()=>{
  expect(()=>portalToken(request({cookie:'erp_session=otro'}))).toThrow();
  const token='a'.repeat(43);expect(portalToken(request({cookie:`erp_session=otro; portal_session=${token}`}))).toBe(token);
  expect(()=>portalToken(request({cookie:`portal_session=${token}; portal_session=${token}`}))).toThrow();
 });
 it('exige cabecera propia, origen exacto en escritura y ausencia de cross-site',()=>{
  expect(()=>portalRequest(request({'x-portal-browser':'1'}))).not.toThrow();
  expect(()=>portalRequest(request({'x-erp-browser':'1'}))).toThrow();
  expect(()=>portalRequest(request({'x-portal-browser':'1'},'POST'))).toThrow();
  expect(()=>portalRequest(request({'x-portal-browser':'1',origin:'https://outside.example.test'},'POST'))).toThrow();
  expect(()=>portalRequest(request({'x-portal-browser':'1',origin:'http://127.0.0.1:4300','sec-fetch-site':'cross-site'},'POST'))).toThrow();
 });
 it('producción requiere transporte seguro y cookie __Host propia',()=>{
  process.env.NODE_ENV='production';process.env.CORS_ORIGINS='https://portal.example.test';expect(portalCookieName()).toBe('__Host-portal_session');
  expect(()=>portalRequest(request({'x-portal-browser':'1',origin:'https://portal.example.test'},'POST'))).toThrow();
  expect(()=>portalRequest(request({'x-portal-browser':'1',origin:'https://portal.example.test'},'POST',true))).not.toThrow();
 });
});
