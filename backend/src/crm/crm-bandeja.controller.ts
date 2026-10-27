import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CrmBandejaQuery } from './crm-bandeja.dto';
import { CrmBandejaService } from './crm-bandeja.service';
@Controller('crm/bandeja') @Roles(RolUsuario.ADMIN, RolUsuario.USER)
export class CrmBandejaController {
  constructor(private readonly service: CrmBandejaService) {}
  @Get() @Header('Cache-Control', 'private, no-store')
  list(@Query() q: CrmBandejaQuery, @Req() req: { user: JwtPayload }) { return this.service.list(q, req.user); }
}
