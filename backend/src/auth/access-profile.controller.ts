import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Post, Put, Req } from '@nestjs/common';
import { RolUsuario } from '../common/enums/app.enums';
import { Roles } from './roles.decorator';
import { JwtPayload } from './auth.types';
import { AccessProfileDto, AccessVersionDto, AssignAccessProfileDto, UpdateAccessProfileDto } from './access-profile.dto';
import { AccessProfileService } from './access-profile.service';

@Controller('auth')
@Roles(RolUsuario.ADMIN)
export class AccessProfileController {
  constructor(private readonly profiles: AccessProfileService) {}

  @Get('permission-catalog') @Header('Cache-Control','private, no-store')
  catalog() { return this.profiles.catalog(); }

  @Get('access-profiles') @Header('Cache-Control','private, no-store')
  list() { return this.profiles.list(); }

  @Post('access-profiles')
  create(@Body() body: AccessProfileDto, @Req() req: { user: JwtPayload }) { return this.profiles.create(body,req.user); }

  @Put('access-profiles/:id')
  update(@Param('id',ParseIntPipe) id: number, @Body() body: UpdateAccessProfileDto, @Req() req: { user: JwtPayload }) {
    return this.profiles.update(id,body,req.user);
  }

  @Delete('access-profiles/:id')
  remove(@Param('id',ParseIntPipe) id: number, @Body() body: AccessVersionDto, @Req() req: { user: JwtPayload }) {
    return this.profiles.remove(id,body.version,req.user);
  }

  @Put('users/:id/access-profile')
  assign(@Param('id',ParseIntPipe) id: number, @Body() body: AssignAccessProfileDto, @Req() req: { user: JwtPayload }) {
    return this.profiles.assign(id,body,req.user);
  }
}
