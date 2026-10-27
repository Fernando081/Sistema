import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';

describe('HTTP de procesos automáticos: acceso administrativo', () => {
  let app: INestApplication;
  const getScheduledJobs = jest
    .fn()
    .mockResolvedValue([
      { name: 'operational_alerts', lastRun: null, recentRuns: [] },
    ]);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: { getScheduledJobs } },
        {
          provide: AuthService,
          useValue: {
            authenticate: async (token: string) => {
              if (!['admin', 'user'].includes(token))
                throw new UnauthorizedException();
              return { idUser: 1, sub: 'test-user', role: token };
            },
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('rechaza acceso anónimo', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/scheduled-jobs')
      .expect(401);
    expect(getScheduledJobs).not.toHaveBeenCalled();
  });
  it('rechaza usuario sin rol administrador', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/scheduled-jobs')
      .set('Authorization', 'Bearer user')
      .expect(403);
    expect(getScheduledJobs).not.toHaveBeenCalled();
  });
  it('devuelve historial al administrador', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/v1/dashboard/scheduled-jobs')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(result.body[0].name).toBe('operational_alerts');
    expect(getScheduledJobs).toHaveBeenCalledTimes(1);
  });
});
