// backend/src/catalogos/uso-cfdi/uso-cfdi.controller.ts
import { Controller, Get } from '@nestjs/common';
import { UsoCfdiService } from './uso-cfdi.service';
@Controller('catalogos/uso-cfdi')
export class UsoCfdiController {
  constructor(private readonly service: UsoCfdiService) {}
  @Get()
  findAll() { return this.service.findAll(); }
}