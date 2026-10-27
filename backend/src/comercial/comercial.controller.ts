import { Body,Controller,Get,Header,Param,ParseIntPipe,Post,Put,Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { RolUsuario } from '../common/enums/app.enums';
import { ComercialService } from './comercial.service';
import { ConfigClienteDto,CreateListaDto,ResolverAutorizacionDto,SetPrecioEspecialDto,SetPrecioListaDto,SimularPrecioDto,SolicitarAutorizacionDto,ReglaAprobacionDto,LimiteAprobadorDto } from './comercial.dto';
type CommercialRequest={user:JwtPayload};
@Controller('comercial')
export class ComercialController{
 constructor(private readonly s:ComercialService){}
 @Post('simular-precio')simulate(@Body()d:SimularPrecioDto){return this.s.simulate(d);}
 @Get('clientes')@Header('Cache-Control','private, no-store')clients(){return this.s.clients();}
 @Put('clientes/:id')@Roles(RolUsuario.ADMIN)
 config(@Param('id',ParseIntPipe)id:number,@Body()d:ConfigClienteDto,@Req()r:CommercialRequest){return this.s.configureClient(id,d,r.user);}
 @Get('listas')@Header('Cache-Control','private, no-store')lists(){return this.s.lists();}
 @Post('listas')@Roles(RolUsuario.ADMIN)
 createList(@Body()d:CreateListaDto,@Req()r:CommercialRequest){return this.s.createList(d,r.user);}
 @Put('listas/:id/precios')@Roles(RolUsuario.ADMIN)
 setList(@Param('id',ParseIntPipe)id:number,@Body()d:SetPrecioListaDto,@Req()r:CommercialRequest){return this.s.setListPrice(id,d,r.user);}
 @Put('precios-especiales')@Roles(RolUsuario.ADMIN)
 setSpecial(@Body()d:SetPrecioEspecialDto,@Req()r:CommercialRequest){return this.s.setSpecial(d,r.user);}
 @Get('autorizaciones')@Header('Cache-Control','private, no-store')authorizations(){return this.s.authorizations();}
 @Post('autorizaciones')request(@Body()d:SolicitarAutorizacionDto,@Req()r:CommercialRequest){return this.s.requestAuthorization(d,r.user);}
 @Post('autorizaciones/:id/resolver')@Roles(RolUsuario.ADMIN)@Permissions('credito.autorizar')
 resolve(@Param('id',ParseIntPipe)id:number,@Body()d:ResolverAutorizacionDto,@Req()r:CommercialRequest){return this.s.resolve(id,d,r.user);}
 @Get('politica-aprobaciones')@Roles(RolUsuario.ADMIN)@Header('Cache-Control','private, no-store')
 approvalPolicy(){return this.s.approvalPolicy();}
 @Put('reglas-aprobacion')@Roles(RolUsuario.ADMIN)@Permissions('comercial.configurar_aprobaciones')
 setRule(@Body()d:ReglaAprobacionDto,@Req()r:CommercialRequest){return this.s.setApprovalRule(d,r.user);}
 @Put('limites-aprobacion/:id')@Roles(RolUsuario.ADMIN)@Permissions('comercial.configurar_aprobaciones')
 setLimit(@Param('id',ParseIntPipe)id:number,@Body()d:LimiteAprobadorDto,@Req()r:CommercialRequest){return this.s.setApproverLimit(id,d,r.user);}
}
