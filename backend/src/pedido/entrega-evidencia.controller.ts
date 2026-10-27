import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Req, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload } from '../auth/auth.types';
import { Permissions } from '../auth/permissions.decorator';
import { EntregaEvidenciaDto } from './entrega-evidencia.dto';
import { EntregaEvidenciaService } from './entrega-evidencia.service';
@Controller('pedidos/:id/entrega')
@Permissions('pedidos.entregas')
export class EntregaEvidenciaController {
 constructor(private readonly service:EntregaEvidenciaService){}
 @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @Get() status(@Param('id',ParseIntPipe)id:number,@Req()req:{user:JwtPayload}){return this.service.status(id,req.user);}
 @Header('Cache-Control','private, no-store') @Post('evidencia') @Throttle({default:{limit:10,ttl:60000}})
 @UseInterceptors(FileFieldsInterceptor([{name:'firma',maxCount:1},{name:'foto',maxCount:1}],{storage:memoryStorage(),limits:{fileSize:5*1024*1024,files:2,fields:11,fieldSize:4096,parts:13}}))
 register(@Param('id',ParseIntPipe)id:number,@Body()dto:EntregaEvidenciaDto,@UploadedFiles()files:Partial<Record<'firma'|'foto',Express.Multer.File[]>>|undefined,@Req()req:{user:JwtPayload}){return this.service.register(id,dto,files??{},req.user);}
 @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @Get('archivos/:tipo')
 async file(@Param('id',ParseIntPipe)id:number,@Param('tipo')kind:string,@Req()req:{user:JwtPayload}){
  const row=await this.service.file(id,kind,req.user),ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}as Record<string,string>)[row.mime];
  return new StreamableFile(row.contenido,{type:row.mime,disposition:`attachment; filename="pedido-${id}-${kind}.${ext}"`});
 }
 @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff') @Get('comprobante')
 async pdf(@Param('id',ParseIntPipe)id:number,@Req()req:{user:JwtPayload}){return new StreamableFile(await this.service.pdf(id,req.user),{type:'application/pdf',disposition:`attachment; filename="entrega-pedido-${id}.pdf"`});}
}

