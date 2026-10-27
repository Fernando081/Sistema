import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { SecuenciaQuery } from './crm-secuencias.dto';
import { CrmReporteCancelarReintentoDto, CrmReporteControlDto, CrmReporteCrearDto, CrmReporteReintentoDto } from './crm-reportes.dto';
import { CrmReportesColaService } from './crm-reportes-cola.service';
import { CrmReportesService } from './crm-reportes.service';
@Controller('crm/reportes-programados') @Roles(RolUsuario.ADMIN) @Permissions('crm.reportes.programar')
export class CrmReportesController {
 constructor(private readonly service:CrmReportesService,private readonly queue:CrmReportesColaService){}
 @Post(':id/resultados/:resultado/reintentar') @Header('Cache-Control','private, no-store')
 retry(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Param('resultado',new ParseUUIDPipe({version:'4'}))resultado:string,@Body()_d:CrmReporteReintentoDto,@Req()r:{user:JwtPayload}){return this.queue.request(id,resultado,r.user);}
 @Post(':id/resultados/:resultado/cancelar-reintento') @Header('Cache-Control','private, no-store')
 cancelRetry(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Param('resultado',new ParseUUIDPipe({version:'4'}))resultado:string,@Body()d:CrmReporteCancelarReintentoDto,@Req()r:{user:JwtPayload}){return this.queue.cancel(id,resultado,d.expectedVersion,r.user);}
 @Get() @Header('Cache-Control','private, no-store') list(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.list(q.page,r.user);}
 @Post() @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 create(@Body()d:CrmReporteCrearDto,@Req()r:{user:JwtPayload}){return this.service.create(d,r.user);}
 @Get(':id/historial') @Header('Cache-Control','private, no-store') history(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.history(id,q.page,r.user);}
 @Patch(':id') @Header('Cache-Control','private, no-store') control(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:CrmReporteControlDto,@Req()r:{user:JwtPayload}){return this.service.control(id,d,r.user);}
}
