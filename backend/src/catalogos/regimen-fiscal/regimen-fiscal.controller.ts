// backend/src/catalogos/regimen-fiscal/regimen-fiscal.controller.ts
import { Controller, Get } from '@nestjs/common';
import { RegimenFiscalService } from './regimen-fiscal.service';
@Controller('catalogos/regimen-fiscal')
export class RegimenFiscalController {
  constructor(private readonly service: RegimenFiscalService) {}
  @Get()
  findAll() {
    return this.service.findAll();
  }
}
