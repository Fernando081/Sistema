import { Body,Controller,Get,Header,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { SecuenciaQuery } from './crm-secuencias.dto';
import { SecuenciaAplicarDto,SecuenciaReglaDto } from './crm-secuencia-reglas.dto';
import { CrmSecuenciaReglasService } from './crm-secuencia-reglas.service';
@Controller('crm/reglas-secuencias') @Roles(RolUsuario.ADMIN) @Permissions('crm.secuencias.gestionar')
export class CrmSecuenciaReglasController {
 constructor(private readonly service:CrmSecuenciaReglasService){}
 @Get() @Header('Cache-Control','private, no-store') list(@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.list(q,r.user);}
 @Post() @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}}) create(@Body()d:SecuenciaReglaDto,@Req()r:{user:JwtPayload}){return this.service.create(d,r.user);}
 @Get(':id/eventos') @Header('Cache-Control','private, no-store') preview(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.preview(id,q,r.user);}
 @Get(':id/historial') @Header('Cache-Control','private, no-store') history(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Query()q:SecuenciaQuery,@Req()r:{user:JwtPayload}){return this.service.history(id,q,r.user);}
 @Post(':id/aplicar') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:20,ttl:60000}}) apply(@Param('id',new ParseUUIDPipe({version:'4'}))id:string,@Body()d:SecuenciaAplicarDto,@Req()r:{user:JwtPayload}){return this.service.apply(id,d,r.user);}
}
