import { Body,Controller,Get,Header,Param,ParseIntPipe,Post,Query,Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { CampanaConsentimientoService } from './campana-consentimiento.service';
import { CommercialQuery,ConsentDto,ConsentQuery,PrepareCampaignDto } from './campana-consentimiento.dto';
@Controller('clientes/:cliente/consentimiento-comercial') @Permissions('crm.campanas.gestionar')
export class ConsentimientoComercialController {
 constructor(private readonly service:CampanaConsentimientoService){}
 @Get() @Header('Cache-Control','private, no-store')
 contacts(@Param('cliente',ParseIntPipe)client:number,@Query()query:ConsentQuery,@Req()req:{user:JwtPayload}){return this.service.contacts(client,query,req.user);}
 @Get('historial') @Header('Cache-Control','private, no-store')
 history(@Param('cliente',ParseIntPipe)client:number,@Query()query:CommercialQuery,@Req()req:{user:JwtPayload}){return this.service.history(client,query,req.user);}
 @Post(':contacto') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 consent(@Param('cliente',ParseIntPipe)client:number,@Param('contacto',ParseIntPipe)contact:number,@Body()dto:ConsentDto,@Req()req:{user:JwtPayload}){return this.service.consent(client,contact,dto,req.user);}
}
@Controller('crm/campanas-locales') @Permissions('crm.campanas.gestionar')
export class CampanasLocalesController {
 constructor(private readonly service:CampanaConsentimientoService){}
 @Get() @Header('Cache-Control','private, no-store')
 campaigns(@Query()query:CommercialQuery,@Req()req:{user:JwtPayload}){return this.service.campaigns(query,req.user);}
 @Get(':id/destinatarios') @Header('Cache-Control','private, no-store')
 preview(@Param('id',ParseIntPipe)id:number,@Query()query:CommercialQuery,@Req()req:{user:JwtPayload}){return this.service.preview(id,query,req.user);}
 @Post(':id/preparar') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:10,ttl:60000}})
 prepare(@Param('id',ParseIntPipe)id:number,@Body()dto:PrepareCampaignDto,@Req()req:{user:JwtPayload}){return this.service.prepare(id,dto,req.user);}
}
