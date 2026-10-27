import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { AlmacenMovilService } from './almacen-movil.service';
import { AnularPickingDto, MovilPageQuery, VerificarPickingDto } from './almacen-movil.dto';
@Controller('almacen/movil') @Permissions('inventario.escanear')
export class AlmacenMovilController {
 constructor(private readonly service:AlmacenMovilService){}
 @Get('pedidos') @Header('Cache-Control','private, no-store') list(@Query()q:MovilPageQuery,@Req()r:{user:JwtPayload}){return this.service.list(q,r.user);}
 @Get('pedidos/:id') @Header('Cache-Control','private, no-store') detail(@Param('id',ParseIntPipe)id:number,@Query()q:MovilPageQuery,@Req()r:{user:JwtPayload}){return this.service.detail(id,q.page,r.user);}
 @Get('pedidos/:id/historial') @Header('Cache-Control','private, no-store') history(@Param('id',ParseIntPipe)id:number,@Query()q:MovilPageQuery,@Req()r:{user:JwtPayload}){return this.service.history(id,q.page,r.user);}
 @Post('pedidos/:id/verificar') @Header('Cache-Control','private, no-store') verify(@Param('id',ParseIntPipe)id:number,@Body()d:VerificarPickingDto,@Req()r:{user:JwtPayload}){return this.service.verify(id,d,r.user);}
 @Post('pedidos/:id/anular') @Header('Cache-Control','private, no-store') cancel(@Param('id',ParseIntPipe)id:number,@Body()d:AnularPickingDto,@Req()r:{user:JwtPayload}){return this.service.cancel(id,d,r.user);}
 @Get('etiquetas/:tipo/:id') @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
 async label(@Param('tipo')kind:string,@Param('id',ParseIntPipe)id:number,@Req()r:{user:JwtPayload}){return new StreamableFile(await this.service.label(kind,id,r.user),{type:'application/pdf',disposition:`attachment; filename="etiqueta-${id}.pdf"`});}
}
