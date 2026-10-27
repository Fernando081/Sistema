import { Body,Controller,Get,Header,Param,ParseUUIDPipe,Patch,Post,Query,Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { CrmSecuenciasService } from './crm-secuencias.service';
import { SecuenciaControlDto,SecuenciaInicioDto,SecuenciaModeloDto,SecuenciaQuery,SecuenciaTransicionDto } from './crm-secuencias.dto';
@Controller('crm/secuencias') @Permissions('crm.secuencias.gestionar')
export class CrmSecuenciasController {
 constructor(private readonly service:CrmSecuenciasService){}
 @Header('Cache-Control','private, no-store') @Get('modelos') models(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.models(q,r.user);}
 @Header('Cache-Control','private, no-store') @Post('modelos') @Throttle({default:{limit:10,ttl:60000}}) model(@Body()d:SecuenciaModeloDto,@Req()r:{user:JwtPayload}){return this.service.createModel(d,r.user);}
 @Header('Cache-Control','private, no-store') @Get('clientes') clients(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.clients(q,r.user);}
 @Header('Cache-Control','private, no-store') @Get('responsables') owners(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.owners(q,r.user);}
 @Header('Cache-Control','private, no-store') @Get(':id/controles') controls(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.controls(id,q,r.user);}
 @Header('Cache-Control','private, no-store') @Post(':id/controles') @Throttle({default:{limit:20,ttl:60000}}) control(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:SecuenciaControlDto,@Req()r:{user:JwtPayload}){return this.service.control(id,d,r.user);}
 @Header('Cache-Control','private, no-store') @Get() runs(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.runs(q,r.user);}
 @Header('Cache-Control','private, no-store') @Post() @Throttle({default:{limit:10,ttl:60000}}) start(@Body()d:SecuenciaInicioDto,@Req()r:{user:JwtPayload}){return this.service.start(d,r.user);}
 @Header('Cache-Control','private, no-store') @Get(':id') detail(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Req()r:{user:JwtPayload}){return this.service.detail(id,r.user);}
 @Header('Cache-Control','private, no-store') @Patch(':id/tarea') @Throttle({default:{limit:20,ttl:60000}}) transition(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:SecuenciaTransicionDto,@Req()r:{user:JwtPayload}){return this.service.transition(id,d,r.user);}
}
