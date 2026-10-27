import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { CrmSolicitudesWebController } from './crm-solicitudes-web.controller';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';
import { CrmSolicitudesWebMaintenance } from './crm-solicitudes-web-maintenance.service';
import { RolesGuard } from '../auth/roles.guard';
import { Reflector } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { CrmWebMetricsService } from './crm-web-metrics.service';

describe('Bandeja web privada', () => {
  it('deniega usuario común y valida UUID/estado antes de modificar', async () => {
    const status = { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', estado: 'Pendiente',
      version: 1, createdAt: '2026-10-10T12:00:00Z', expiresAt: '2027-01-08T12:00:00Z',
      contenido: 'Vigente', idOportunidad: null };
    const service = { list: jest.fn().mockResolvedValue([]), review: jest.fn(), purgeExpired: jest.fn(), convert: jest.fn(),
      receiptStatus: jest.fn().mockResolvedValue(status), resolutions: jest.fn().mockResolvedValue([]), resolve: jest.fn().mockResolvedValue({ version: 2 }) };
    const module = await Test.createTestingModule({ controllers: [CrmSolicitudesWebController],
      providers: [{ provide: CrmSolicitudesWebService, useValue: service },
        { provide: CrmSolicitudesWebMaintenance, useValue: {status: () => ({enabled:false})} },
        { provide: CrmWebMetricsService, useValue: { report: jest.fn() } }] }).compile();
    const app = module.createNestApplication();
    // Isolated role test. Production still uses its global JWT guard.
    app.use((req: Request & { user?: { role: string; idUser: number } }, _res: Response, next: NextFunction) => {
      req.user = { role: req.headers['x-test-role'] === 'admin' ? 'admin' : 'user', idUser: 1 }; next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    try {
      await request(app.getHttpServer()).get('/crm/solicitudes-web').expect(403);
      await request(app.getHttpServer()).get('/crm/solicitudes-web/mantenimiento').expect(403);
      await request(app.getHttpServer()).get('/crm/solicitudes-web/puente').expect(403);
      const bridge = await request(app.getHttpServer()).get('/crm/solicitudes-web/puente').set('x-test-role', 'admin').expect(200);
      expect(bridge.headers['cache-control']).toBe('no-store');
      expect(Object.keys(bridge.body).sort()).toEqual(['enabled', 'configured', 'mode', 'activeKeyId', 'previous'].sort());
      await request(app.getHttpServer()).get('/crm/solicitudes-web/' + status.requestId + '/estado').expect(403);
      expect(service.receiptStatus).not.toHaveBeenCalled();
      await request(app.getHttpServer()).post('/crm/solicitudes-web/purgar-vencidas').expect(403);
      await request(app.getHttpServer()).post('/crm/solicitudes-web/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/convertir').send({expectedVersion:1}).expect(403);
      await request(app.getHttpServer()).get('/crm/solicitudes-web').set('x-test-role', 'admin').expect(200);
      await request(app.getHttpServer()).get('/crm/solicitudes-web/no-uuid/estado').set('x-test-role', 'admin').expect(400);
      expect(service.receiptStatus).not.toHaveBeenCalled();
      const receipt = await request(app.getHttpServer()).get('/crm/solicitudes-web/' + status.requestId + '/estado')
        .set('x-test-role', 'admin').expect(200);
      expect(receipt.headers['cache-control']).toBe('no-store');
      expect(receipt.body).toEqual(status);
      expect(service.receiptStatus).toHaveBeenCalledWith(status.requestId);
      const resolutionBody = { operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', motivo: 'Clave', expectedVersion: 1, originalVerificado: true };
      const resolutionRoute = '/crm/solicitudes-web/' + status.requestId;
      await request(app.getHttpServer()).get(resolutionRoute + '/resoluciones').expect(403);
      await request(app.getHttpServer()).post(resolutionRoute + '/resolver').send(resolutionBody).expect(403);
      for (const body of [{ ...resolutionBody, originalVerificado: false }, { ...resolutionBody, motivo: 'Otro' },
        { ...resolutionBody, operationId: 'invalid' }, { ...resolutionBody, payload: { contact: 'no' } }]) {
        await request(app.getHttpServer()).post(resolutionRoute + '/resolver').set('x-test-role', 'admin').send(body).expect(400);
      }
      expect(service.resolve).not.toHaveBeenCalled();
      await request(app.getHttpServer()).post(resolutionRoute + '/resolver').set('x-test-role', 'admin').send(resolutionBody).expect(201);
      expect(service.resolve).toHaveBeenCalledWith(status.requestId, resolutionBody.operationId, 'Clave', 1, 1);
      const history = await request(app.getHttpServer()).get(resolutionRoute + '/resoluciones').set('x-test-role', 'admin').expect(200);
      expect(history.headers['cache-control']).toBe('no-store');
      await request(app.getHttpServer()).patch('/crm/solicitudes-web/no-uuid').set('x-test-role', 'admin')
        .send({ estado: 'Revisada', expectedVersion: 1 }).expect(400);
      await request(app.getHttpServer()).patch('/crm/solicitudes-web/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
        .set('x-test-role', 'admin').send({ estado: 'Ganada', expectedVersion: 1 }).expect(400);
      expect(service.review).not.toHaveBeenCalled();
      expect(service.purgeExpired).not.toHaveBeenCalled();
      expect(service.convert).not.toHaveBeenCalled();
      await request(app.getHttpServer()).post('/crm/solicitudes-web/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/convertir')
        .set('x-test-role', 'admin').send({ expectedVersion: 1, idResponsable: 0 }).expect(400);
      expect(service.convert).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
