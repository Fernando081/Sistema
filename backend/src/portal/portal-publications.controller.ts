import { Body,Controller,Get,Header,Param,ParseIntPipe,Post,Query,Req,StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { PortalQuery } from './portal.dto';
import { PortalPublishDto,PortalSourceDto,PortalWithdrawDto } from './portal-publications.dto';
import { PortalPublicationsService } from './portal-publications.service';
import { portalRequest,portalToken } from './portal-transport';
function attachment(file:{contenido:Buffer;mime:string;clase:string},name:string){
 return new StreamableFile(file.contenido,{type:file.mime,disposition:`attachment; filename="${name}-${file.clase}.${file.mime==='application/xml'?'xml':'pdf'}"`});
}
@Controller('clientes/:cliente/portal-publicaciones') @Permissions('portal.publicar')
export class PortalPublicationAdminController {
 constructor(private readonly service:PortalPublicationsService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Param('cliente',ParseIntPipe)client:number,@Query()query:PortalQuery,@Req()req:{user:JwtPayload}){return this.service.adminList(client,query,req.user);}
 @Get('candidatos/:tipo') @Header('Cache-Control','private, no-store') candidates(@Param('cliente',ParseIntPipe)client:number,@Param('tipo')tipo:PortalSourceDto['tipo'],@Query()query:PortalQuery,@Req()req:{user:JwtPayload}){return this.service.candidates(client,tipo,query,req.user);}
 @Post('vista-previa') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @Throttle({default:{limit:10,ttl:60000}})
 async preview(@Param('cliente',ParseIntPipe)client:number,@Body()dto:PortalSourceDto,@Req()req:{user:JwtPayload}){return attachment(await this.service.preview(client,dto,req.user),'revision');}
 @Post() @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 publish(@Param('cliente',ParseIntPipe)client:number,@Body()dto:PortalPublishDto,@Req()req:{user:JwtPayload}){return this.service.publish(client,dto,req.user);}
 @Post(':id/retirar') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 withdraw(@Param('cliente',ParseIntPipe)client:number,@Param('id',ParseIntPipe)id:number,@Body()dto:PortalWithdrawDto,@Req()req:{user:JwtPayload}){return this.service.withdraw(client,id,dto,req.user);}
}
@Controller('portal/archivos') @Public()
export class PortalPublicationController {
 constructor(private readonly service:PortalPublicationsService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Query()query:PortalQuery,@Req()req:Request){portalRequest(req);return this.service.list(portalToken(req),query);}
 @Get(':id/descarga') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @Throttle({default:{limit:30,ttl:60000}})
 async download(@Param('id',ParseIntPipe)id:number,@Req()req:Request){portalRequest(req);return attachment(await this.service.download(portalToken(req),id),'archivo-'+id);}
}
