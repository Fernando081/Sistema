import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { JwtPayload } from './auth.types';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user?.role) throw new ForbiddenException('No tienes permisos suficientes');

    const rows = await queryRows<{ code: string }>(this.dataSource, `
      SELECT requested.code
      FROM unnest($1::text[]) AS requested(code)
      WHERE COALESCE(
        (SELECT up.granted FROM app_user_permission up
          WHERE up.id_user=$2 AND up.permission_code=requested.code),
        EXISTS(SELECT 1 FROM app_role_permission rp
          WHERE rp.role=$3 AND rp.permission_code=requested.code),
        false
      )`, [required, user.idUser ?? null, user.role]);
    const granted = new Set(rows.map(row => row.code));
    const missing = required.filter(code => !granted.has(code));
    if (missing.length) throw new ForbiddenException(`Permiso requerido: ${missing.join(', ')}`);
    return true;
  }
}
