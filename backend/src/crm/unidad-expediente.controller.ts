import { Body,Controller,Get,Header,Param,ParseIntPipe,Post,Query,Req,Res,StreamableFile,UploadedFile,UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { UnidadExpedienteService } from './unidad-expediente.service';
import { ArchivoUnidadDto,CerrarMantenimientoDto,ExpedienteQuery,LecturaUnidadDto,MantenimientoUnidadDto,MotivoExpedienteDto } from './unidad-expediente.dto';
type RequestActor={user:JwtPayload};
@Controller('crm/unidades/:unidad')
@Permissions('crm.unidades.consultar')
export class UnidadExpedienteController{
 constructor(private readonly service:UnidadExpedienteService){}
 @Get('expediente')@Header('Cache-Control','private, no-store')
 expediente(@Param('unidad',ParseIntPipe)id:number,@Query()query:ExpedienteQuery,@Req()req:RequestActor){return this.service.expediente(id,query,req.user);}
 @Post('lecturas')@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 lectura(@Param('unidad',ParseIntPipe)id:number,@Body()dto:LecturaUnidadDto,@Req()req:RequestActor){return this.service.addReading(id,dto,req.user);}
 @Post('lecturas/:lectura/anular')@Roles(RolUsuario.ADMIN)@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 anular(@Param('unidad',ParseIntPipe)id:number,@Param('lectura',ParseIntPipe)reading:number,@Body()dto:MotivoExpedienteDto,@Req()req:RequestActor){return this.service.cancelReading(id,reading,dto,req.user);}
 @Post('mantenimientos')@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 mantenimiento(@Param('unidad',ParseIntPipe)id:number,@Body()dto:MantenimientoUnidadDto,@Req()req:RequestActor){return this.service.addMaintenance(id,dto,req.user);}
 @Post('mantenimientos/:mantenimiento/cerrar')@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 cerrar(@Param('unidad',ParseIntPipe)id:number,@Param('mantenimiento',ParseIntPipe)maintenance:number,@Body()dto:CerrarMantenimientoDto,@Req()req:RequestActor){return this.service.closeMaintenance(id,maintenance,dto,req.user);}
 @Post('archivos')@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 @Throttle({default:{limit:10,ttl:60000}})
 @UseInterceptors(FileInterceptor('archivo',{storage:memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,fieldSize:1024,parts:3}}))
 archivo(@Param('unidad',ParseIntPipe)id:number,@Body()dto:ArchivoUnidadDto,@UploadedFile()file:Express.Multer.File|undefined,@Req()req:RequestActor){return this.service.upload(id,dto,file,req.user);}
 @Get('archivos/:archivo')@Header('Cache-Control','private, no-store')
 async descargar(@Param('unidad',ParseIntPipe)id:number,@Param('archivo',ParseIntPipe)file:number,@Req()req:RequestActor,@Res({passthrough:true})res:Response){
  const row=await this.service.file(id,file,req.user),extension=({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[row.mime];
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  return new StreamableFile(row.contenido,{type:row.mime,disposition:`attachment; filename="unidad-${id}-archivo-${file}.${extension}"`});
 }
 @Post('archivos/:archivo/retirar')@Roles(RolUsuario.ADMIN)@Permissions('crm.unidades.consultar','crm.unidades.gestionar')
 retirar(@Param('unidad',ParseIntPipe)id:number,@Param('archivo',ParseIntPipe)file:number,@Body()dto:MotivoExpedienteDto,@Req()req:RequestActor){return this.service.withdraw(id,file,dto,req.user);}
}
