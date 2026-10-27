import { Body, Controller, Get, Header, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './browser-auth';
import { clearBrowserCookie } from './browser-auth';
import { JwtPayload } from './auth.types';
import { DisableMfaDto, MfaCodeDto, MfaPasswordDto } from './mfa.dto';

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly auth:AuthService){}
  @Get('status') @Header('Cache-Control','private, no-store') status(@Req() req:{user:JwtPayload}){return this.auth.mfa.status(req.user);}
  @Post('setup') @Throttle({default:{limit:5,ttl:60000}})
  @Header('Cache-Control','private, no-store')
  begin(@Body() body:MfaPasswordDto,@Req() req:{user:JwtPayload}){return this.auth.mfa.begin(req.user,body.currentPassword);}
  @Post('confirm') @Throttle({default:{limit:10,ttl:60000}})
  @Header('Cache-Control','private, no-store')
  async confirm(@Body() body:MfaCodeDto,@Req() req:AuthenticatedRequest&{user:JwtPayload},@Res({passthrough:true}) response:Response){
    const result=await this.auth.mfa.confirm(req.user,body.code);if(req.authTransport==='cookie')clearBrowserCookie(response);return result;
  }
  @Post('disable') @Throttle({default:{limit:5,ttl:60000}})
  @Header('Cache-Control','private, no-store')
  async disable(@Body() body:DisableMfaDto,@Req() req:AuthenticatedRequest&{user:JwtPayload},@Res({passthrough:true}) response:Response){
    const result=await this.auth.mfa.disable(req.user,body.currentPassword,body.code);if(req.authTransport==='cookie')clearBrowserCookie(response);return result;
  }
}
