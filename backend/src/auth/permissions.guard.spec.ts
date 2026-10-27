import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const getAllAndOverride = jest.fn();
  const query = jest.fn();
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const dataSource = { query } as unknown as DataSource;
  const context = (user?: { idUser?: number; role: string }) => ({
    getHandler: () => function handler() {}, getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('no consulta la base cuando la ruta no declara permisos', async () => {
    getAllAndOverride.mockReturnValue(undefined);
    await expect(new PermissionsGuard(reflector,dataSource).canActivate(context())).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('acepta únicamente cuando todos los permisos fueron concedidos', async () => {
    getAllAndOverride.mockReturnValue(['caja.cerrar','contabilidad.operar']);
    query.mockResolvedValue([{code:'caja.cerrar'},{code:'contabilidad.operar'}]);
    await expect(new PermissionsGuard(reflector,dataSource).canActivate(context({idUser:3,role:'admin'}))).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('fn_effective_permission'),[['caja.cerrar','contabilidad.operar'],3,'admin']);
  });

  it('indica el permiso faltante sin autorizar parcialmente', async () => {
    getAllAndOverride.mockReturnValue(['inventario.ajustar']);
    query.mockResolvedValue([]);
    await expect(new PermissionsGuard(reflector,dataSource).canActivate(context({idUser:8,role:'user'})))
      .rejects.toEqual(new ForbiddenException('Permiso requerido: inventario.ajustar'));
  });
});
