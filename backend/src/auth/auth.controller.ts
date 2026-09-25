import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateUserDto, UpdateUserPermissionsDto } from './auth.dto';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload } from './auth.types';
import { Public } from './public.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { Roles } from './roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.username, body.password);
  }

  @Roles(RolUsuario.ADMIN)
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(
      body.username,
      body.password,
      body.role ?? RolUsuario.USER,
    );
  }

  @Get('me')
  me(@Req() req: { user: JwtPayload }) {
    return this.authService.profile(req.user);
  }

  @Get('users')
  @Roles(RolUsuario.ADMIN)
  users() {
    return this.authService.listUsers();
  }

  @Patch('users/:id')
  @Roles(RolUsuario.ADMIN)
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateUserDto, @Req() req: { user: JwtPayload }) {
    return this.authService.updateUser(id, body, req.user);
  }

  @Get('users/:id/permissions')
  @Roles(RolUsuario.ADMIN)
  userPermissions(@Param('id',ParseIntPipe) id:number){return this.authService.getUserPermissions(id);}

  @Put('users/:id/permissions')
  @Roles(RolUsuario.ADMIN)
  updateUserPermissions(@Param('id',ParseIntPipe) id:number,@Body() body:UpdateUserPermissionsDto){
    return this.authService.updateUserPermissions(id,body.permissions);
  }

  @Post('password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  changePassword(@Body() body: ChangePasswordDto, @Req() req: { user: JwtPayload }) {
    return this.authService.changePassword(req.user, body);
  }

  @Post('logout')
  logout(@Req() req: { user: JwtPayload }) {
    return this.authService.logout(req.user);
  }
}
