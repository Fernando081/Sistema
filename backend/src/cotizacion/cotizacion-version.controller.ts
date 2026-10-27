import { Body, Controller, ForbiddenException, Get, Header, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { MotivoExpedienteDto } from '../crm/unidad-expediente.dto';
import { InvitarCotizacionDto, NuevaRevisionDto, ResponderCotizacionDto, SellarCotizacionDto, TokenCotizacionDto, VersionQuery } from './cotizacion-version.dto';
import { CotizacionVersionService } from './cotizacion-version.service';
@Controller('cotizacion/:id/versiones')
export class CotizacionVersionController {
 constructor(private readonly service:CotizacionVersionService){}
 @Get() @Header('Cache-Control','private, no-store')
 state(@Param('id',ParseIntPipe)id:number,@Query()query:VersionQuery,@Req()req:{user:JwtPayload}){return this.service.state(id,query,req.user);}
 @Post('sellar') @Permissions('cotizaciones.versionar')
 seal(@Param('id',ParseIntPipe)id:number,@Body()dto:SellarCotizacionDto,@Req()req:{user:JwtPayload}){return this.service.seal(id,dto,req.user);}
 @Post() @Permissions('cotizaciones.versionar')
 revise(@Param('id',ParseIntPipe)id:number,@Body()dto:NuevaRevisionDto,@Req()req:{user:JwtPayload}){return this.service.revise(id,dto,req.user);}
 @Post('enlaces') @Permissions('cotizaciones.versionar')
 invite(@Param('id',ParseIntPipe)id:number,@Body()dto:InvitarCotizacionDto,@Req()req:{user:JwtPayload}){return this.service.invite(id,dto,req.user);}
 @Post('enlaces/:enlace/revocar') @Permissions('cotizaciones.versionar')
 revoke(@Param('id',ParseIntPipe)id:number,@Param('enlace',ParseIntPipe)link:number,@Body()dto:MotivoExpedienteDto,@Req()req:{user:JwtPayload}){return this.service.revoke(id,link,dto,req.user);}
}
@Public()
@Controller('cotizacion-respuesta')
export class CotizacionRespuestaController {
 constructor(private readonly service:CotizacionVersionService){}
 private request(req:Request){if(!req.is('application/json')||req.get('X-Cotizacion-Respuesta')!=='1'||(process.env.NODE_ENV==='production'&&!req.secure))throw new ForbiddenException('Se requiere el formulario de respuesta y transporte seguro.');}
 @Post('consultar') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:30,ttl:60000}})
 consult(@Body()dto:TokenCotizacionDto,@Req()req:Request){this.request(req);return this.service.publicResolve(dto);}
 @Post() @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 respond(@Body()dto:ResponderCotizacionDto,@Req()req:Request){this.request(req);return this.service.publicResolve(dto,dto);}
}
