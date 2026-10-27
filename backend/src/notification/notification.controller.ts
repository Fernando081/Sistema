import { Controller, Get, Header, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications:NotificationService){}
  @Get()
  @Header('Cache-Control','private, no-store')
  list(@Req() req:{user:JwtPayload}){return this.notifications.list(req.user.idUser!);}
  @Post('read-all') readAll(@Req() req:{user:JwtPayload}){return this.notifications.markAllRead(req.user.idUser!);}
  @Post(':id/read') read(@Param('id',ParseIntPipe) id:number,@Req() req:{user:JwtPayload}){return this.notifications.markRead(req.user.idUser!,id);}
}
