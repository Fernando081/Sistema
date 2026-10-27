import { Body, Controller, Get, Header, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PasswordRecoveryService } from './password-recovery.service';
import { RecoverPasswordDto, RecoveryKeyDto, RecoveryProofDto } from './password-recovery.dto';
import { JwtPayload } from './auth.types';
import { Public } from './public.decorator';
import type { AuthenticatedRequest } from './browser-auth';
import { BROWSER_HEADER, clearBrowserCookie, requireBrowserRequest } from './browser-auth';

@Controller('auth/password-recovery')
export class PasswordRecoveryController {
  constructor(private readonly recovery:PasswordRecoveryService){}
  @Get('status') @Header('Cache-Control','private, no-store')
  status(@Req() req:{user:JwtPayload}){return this.recovery.status(req.user);}
  @Post('setup') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
  setup(@Body() body:RecoveryProofDto,@Req() req:{user:JwtPayload}){return this.recovery.begin(req.user,body);}
  @Post('confirm') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
  confirm(@Body() body:RecoveryKeyDto,@Req() req:{user:JwtPayload}){return this.recovery.confirm(req.user,body.recoveryKey);}
  @Post('revoke') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
  revoke(@Body() body:RecoveryProofDto,@Req() req:{user:JwtPayload}){return this.recovery.revoke(req.user,body);}
  @Public() @Post('complete') @Header('Cache-Control','private, no-store') @Throttle({default:{limit:5,ttl:60000}})
  async complete(@Body() body:RecoverPasswordDto,@Req() req:AuthenticatedRequest,@Res({passthrough:true}) response:Response){
    const browser=req.header(BROWSER_HEADER)!==undefined;if(browser)requireBrowserRequest(req);
    const result=await this.recovery.recover(body);if(browser)clearBrowserCookie(response);return result;
  }
}
