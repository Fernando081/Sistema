import { Body, Controller, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/auth.types';
import { RolUsuario } from '../common/enums/app.enums';
import { CreateCostoAdicionalDto, CreateDevolucionProveedorDto, CreateEvaluacionProveedorDto, CreateOrdenDto, CreateRecepcionDto, CreateSolicitudDto } from './abastecimiento.dto';
import { AbastecimientoService } from './abastecimiento.service';
import { Permissions } from '../auth/permissions.decorator';
@Controller('abastecimiento')
export class AbastecimientoController{
 constructor(private readonly service:AbastecimientoService){}
 @Get('solicitudes') requests(){return this.service.requests();}
 @Post('solicitudes') createRequest(@Body() dto:CreateSolicitudDto,@Req() req:{user:JwtPayload}){return this.service.createRequest(dto,req.user?.idUser);}
 @Post('solicitudes/:id/autorizar') @Roles(RolUsuario.ADMIN) @Permissions('compras.autorizar') authorize(@Param('id',ParseIntPipe) id:number,@Req() req:{user:JwtPayload}){return this.service.authorizeRequest(id,req.user?.idUser);}
 @Get('ordenes') orders(){return this.service.orders();}
 @Get('ordenes/:id') order(@Param('id',ParseIntPipe) id:number){return this.service.order(id);}
 @Post('ordenes') @Roles(RolUsuario.ADMIN) @Permissions('compras.autorizar') createOrder(@Body() dto:CreateOrdenDto,@Req() req:{user:JwtPayload}){return this.service.createOrder(dto,req.user?.idUser);}
 @Post('ordenes/:id/recepciones') @Permissions('compras.recibir') receive(@Param('id',ParseIntPipe) id:number,@Body() dto:CreateRecepcionDto,@Req() req:{user:JwtPayload}){return this.service.receive(id,dto,req.user?.idUser);}
 @Get('recepciones') receipts(){return this.service.receipts();}
 @Get('recepciones/:id') receipt(@Param('id',ParseIntPipe) id:number){return this.service.receipt(id);}
 @Get('comparativo/:idProducto') quotes(@Param('idProducto',ParseIntPipe) id:number){return this.service.providerQuotes(id);}
 @Post('recepciones/:id/costos') @Roles(RolUsuario.ADMIN) @Permissions('compras.autorizar') addCost(@Param('id',ParseIntPipe) id:number,@Body() dto:CreateCostoAdicionalDto,@Req() req:{user:JwtPayload}){return this.service.addReceiptCost(id,dto,req.user?.idUser);}
 @Post('devoluciones-proveedor') @Roles(RolUsuario.ADMIN) @Permissions('compras.autorizar') returnProvider(@Body() dto:CreateDevolucionProveedorDto,@Req() req:{user:JwtPayload}){return this.service.returnToProvider(dto,req.user?.idUser);}
 @Post('evaluaciones') @Permissions('compras.recibir') evaluate(@Body() dto:CreateEvaluacionProveedorDto,@Req() req:{user:JwtPayload}){return this.service.evaluateProvider(dto,req.user?.idUser);}
 @Get('evaluaciones') ratings(){return this.service.providerRatings();}
}
