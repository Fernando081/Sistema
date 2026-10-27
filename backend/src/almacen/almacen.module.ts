import { AlmacenMovilController } from './almacen-movil.controller';
import { AlmacenMovilService } from './almacen-movil.service';
import{Module}from'@nestjs/common';import{AlmacenController}from'./almacen.controller';import{AlmacenService}from'./almacen.service';@Module({controllers:[AlmacenMovilController,AlmacenController],providers:[AlmacenMovilService,AlmacenService]})export class AlmacenModule{}
