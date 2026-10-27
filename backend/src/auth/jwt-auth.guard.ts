import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { JwtPayload } from './auth.types';
import { AuthenticatedRequest, browserToken, clearBrowserCookie, requireBrowserRequest, requireBrowserTransport } from './browser-auth';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { user?: JwtPayload }>();
    const authHeader = request.headers.authorization;

    const token=authHeader!==undefined?(authHeader.startsWith('Bearer ')?authHeader.slice(7):null):browserToken(request);
    if(!token)throw new UnauthorizedException('Sesión requerida');
    request.authTransport=authHeader!==undefined?'bearer':'cookie';
    if(request.authTransport==='cookie')requireBrowserTransport(request);
    if(request.authTransport==='cookie'&&!['GET','HEAD','OPTIONS'].includes(request.method))requireBrowserRequest(request);
    try { request.user = await this.authService.authenticate(token); }
    catch(error){
      if(request.authTransport==='cookie'&&error instanceof UnauthorizedException)clearBrowserCookie(context.switchToHttp().getResponse<Response>());
      throw error;
    }
    return true;
  }
}
