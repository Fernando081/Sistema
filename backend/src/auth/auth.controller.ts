import { BadRequestException, Body, Controller, Get, Header, Headers, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateUserDto, UpdateUserPermissionsDto } from './auth.dto';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload } from './auth.types';
import { Public } from './public.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { Roles } from './roles.decorator';
import type { AuthenticatedRequest } from './browser-auth';
import { BROWSER_HEADER, clearBrowserCookie, requireBrowserRequest, setBrowserCookie } from './browser-auth';
import { CompleteMfaDto } from './mfa.dto';
import { LoginResult } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Header('Cache-Control','private, no-store')
  async login(@Body() body: LoginDto, @Headers('user-agent') userAgent: string|undefined,
    @Req() request: AuthenticatedRequest,@Res({passthrough:true}) response: Response) {
    const browser=request.header(BROWSER_HEADER)!==undefined;
    if(browser)requireBrowserRequest(request);
    const result=await this.authService.login(body.username, body.password, userAgent);
    return this.loginResponse(result,browser,response);
  }

  @Public()
  @Post('mfa/login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control','private, no-store')
  async completeMfa(@Body() body:CompleteMfaDto,@Headers('user-agent') userAgent:string|undefined,
    @Req() request:AuthenticatedRequest,@Res({passthrough:true}) response:Response){
    const browser=request.header(BROWSER_HEADER)!==undefined;if(browser)requireBrowserRequest(request);
    return this.loginResponse(await this.authService.completeMfa(body.challenge,body.code,userAgent),browser,response);
  }

  private loginResponse(result:LoginResult,browser:boolean,response:Response){
    if('mfaRequired' in result)return result;
    if(!browser)return result;
    const payload=this.authService.verify(result.access_token);
    if(!payload.idUser)throw new BadRequestException('Registra una cuenta persistida para entrar desde el navegador');
    setBrowserCookie(response,result.access_token,payload.exp);
    return {profile:this.authService.profile(payload),expiresAt:payload.exp};
  }

  @Get('browser-state')
  @Header('Cache-Control','private, no-store')
  browserState(@Req() request: AuthenticatedRequest&{user:JwtPayload}) {
    requireBrowserRequest(request,true);
    return {profile:this.authService.profile(request.user),expiresAt:request.user.exp};
  }

  @Roles(RolUsuario.ADMIN)
  @Post('register')
  async register(@Body() body: RegisterDto,@Req() req:{user:JwtPayload}) {
    return this.authService.register(
      body.username,
      body.password,
      body.role ?? RolUsuario.USER,
      req.user,
    );
  }

  @Get('me')
  me(@Req() req: { user: JwtPayload }) {
    return this.authService.profile(req.user);
  }

  @Get('users')
  @Header('Cache-Control','private, no-store')
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
  @Header('Cache-Control','private, no-store')
  @Roles(RolUsuario.ADMIN)
  userPermissions(@Param('id',ParseIntPipe) id:number){return this.authService.getUserPermissions(id);}

  @Put('users/:id/permissions')
  @Roles(RolUsuario.ADMIN)
  updateUserPermissions(@Param('id',ParseIntPipe) id:number,@Body() body:UpdateUserPermissionsDto,@Req() req:{user:JwtPayload}){
    return this.authService.updateUserPermissions(id,body.permissions,body.accessVersion,req.user);
  }

  @Post('password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async changePassword(@Body() body: ChangePasswordDto, @Req() req: AuthenticatedRequest&{ user: JwtPayload },@Res({passthrough:true}) response:Response) {
    const result=await this.authService.changePassword(req.user, body);
    if(req.authTransport==='cookie')clearBrowserCookie(response);
    return result;
  }

  @Post('logout')
  async logout(@Req() req: AuthenticatedRequest&{ user: JwtPayload },@Res({passthrough:true}) response:Response) {
    const result=await this.authService.logout(req.user);
    if(req.authTransport==='cookie')clearBrowserCookie(response);
    return result;
  }

  @Get('sessions')
  @Header('Cache-Control','private, no-store')
  sessions(@Req() req: {user:JwtPayload}) { return this.authService.listSessions(req.user); }

  @Post('sessions/:id/revoke')
  async revokeSession(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Req() req:AuthenticatedRequest&{user:JwtPayload},@Res({passthrough:true}) response:Response) {
    const result=await this.authService.revokeSession(req.user,id);
    if(req.authTransport==='cookie'&&result.current)clearBrowserCookie(response);
    return result;
  }

  @Post('logout-all')
  async logoutAll(@Req() req:AuthenticatedRequest&{user:JwtPayload},@Res({passthrough:true}) response:Response) {
    const result=await this.authService.logoutAll(req.user);
    if(req.authTransport==='cookie')clearBrowserCookie(response);
    return result;
  }
}
