import { Body,Controller,Get,Header,Param,ParseIntPipe,Post,Query,Req,Res,StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request,Response } from 'express';
import { Public } from '../auth/public.decorator';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { PortalIdentityService } from './portal-identity.service';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalActivarDto,PortalCambiarAccesoDto,PortalInvitarDto,PortalLoginDto,PortalPasswordDto,PortalQuery } from './portal.dto';
import { portalCookie,portalRequest,portalToken } from './portal-transport';
@Controller('clientes/:cliente/portal-accesos') @Permissions('portal.gestionar')
export class PortalAdminController {
 constructor(private readonly service:PortalIdentityService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Param('cliente',ParseIntPipe)id:number,@Query()query:PortalQuery,@Req()req:{user:JwtPayload}){return this.service.list(id,query,req.user);}
 @Post() @Header('Cache-Control','private, no-store') create(@Param('cliente',ParseIntPipe)id:number,@Body()dto:PortalInvitarDto,@Req()req:{user:JwtPayload}){return this.service.create(id,dto,req.user);}
 @Post(':acceso/restablecer') @Header('Cache-Control','private, no-store') reset(@Param('cliente',ParseIntPipe)id:number,@Param('acceso',ParseIntPipe)a:number,@Body()dto:PortalCambiarAccesoDto,@Req()req:{user:JwtPayload}){return this.service.changeAccess(id,a,dto,req.user,'Restablecer');}
 @Post(':acceso/suspender') @Header('Cache-Control','private, no-store') suspend(@Param('cliente',ParseIntPipe)id:number,@Param('acceso',ParseIntPipe)a:number,@Body()dto:PortalCambiarAccesoDto,@Req()req:{user:JwtPayload}){return this.service.changeAccess(id,a,dto,req.user,'Suspender');}
}
// @Public sólo separa del JWT del ERP. TODAS las lecturas usan sesión propia + filtro de cliente.
@Controller('portal') @Public()
export class PortalController {
 constructor(private readonly identity:PortalIdentityService,private readonly documents:PortalDocumentsService){}
 @Post('activar') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
 async activate(@Body()dto:PortalActivarDto,@Req()req:Request,@Res({passthrough:true})res:Response){portalRequest(req);const result=await this.identity.activate(dto);portalCookie(res);return result;}
 @Post('login') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
 async login(@Body()dto:PortalLoginDto,@Req()req:Request,@Res({passthrough:true})res:Response){portalRequest(req);const result=await this.identity.login(dto);portalCookie(res,result.token,result.venceEn);return{venceEn:result.venceEn};}
 @Get('sesion') @Header('Cache-Control','private, no-store')
 state(@Req()req:Request){portalRequest(req);return this.identity.state(portalToken(req));}
 @Post('salir') @Header('Cache-Control','private, no-store')
 async logout(@Req()req:Request,@Res({passthrough:true})res:Response){portalRequest(req);const result=await this.identity.logout(portalToken(req));portalCookie(res);return result;}
 @Post('password') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
 async password(@Body()dto:PortalPasswordDto,@Req()req:Request,@Res({passthrough:true})res:Response){portalRequest(req);const result=await this.identity.password(portalToken(req),dto);portalCookie(res);return result;}
 @Get('documentos/:tipo') @Header('Cache-Control','private, no-store')
 list(@Param('tipo')kind:string,@Query()query:PortalQuery,@Req()req:Request){portalRequest(req);return this.documents.list(portalToken(req),kind,query);}
 @Get('documentos/:tipo/:id') @Header('Cache-Control','private, no-store')
 one(@Param('tipo')kind:string,@Param('id',ParseIntPipe)id:number,@Req()req:Request){portalRequest(req);return this.documents.one(portalToken(req),kind,id);}
 @Get('documentos/:tipo/:id/resumen') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
 async pdf(@Param('tipo')kind:string,@Param('id',ParseIntPipe)id:number,@Req()req:Request){portalRequest(req);return new StreamableFile(await this.documents.pdf(portalToken(req),kind,id),{type:'application/pdf',disposition:`attachment; filename="resumen-${id}.pdf"`});}
}
