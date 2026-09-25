import { Test } from '@nestjs/testing';
import { INestApplication, Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { AuthUser } from '../src/auth/auth-user.entity';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { Roles } from '../src/auth/roles.decorator';
import { RolUsuario } from '../src/common/enums/app.enums';
import { configureApp } from '../src/configure-app';

@Controller('protected')
class ProtectedController {
  @Get() read() { return { ok: true }; }
  @Get('admin') @Roles(RolUsuario.ADMIN) admin() { return { ok: true }; }
}

describe('HTTP: autenticación, permisos y revocación (sin base real)', () => {
  let app: INestApplication;
  let user: AuthUser;
  const oldEnvironment = { ...process.env };
  const repository = {
    findOne: jest.fn(async ({ where }) => where.username === user.username || where.idUser === user.idUser ? { ...user } : null),
    increment: jest.fn(async () => { user.tokenVersion += 1; }),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-http-secret-with-at-least-32-bytes';
    process.env.ALLOW_ENV_AUTH = 'false';
    user = { idUser: 1, username: 'operador', passwordHash: await AuthService.hashPassword('correct-password'), role: 'user', isActive: true, tokenVersion: 0 };
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [AuthController, ProtectedController],
      providers: [AuthService, { provide: getRepositoryToken(AuthUser), useValue: repository },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard }],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.JWT_SECRET = oldEnvironment.JWT_SECRET;
    if (oldEnvironment.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    process.env.ALLOW_ENV_AUTH = oldEnvironment.ALLOW_ENV_AUTH;
    if (oldEnvironment.ALLOW_ENV_AUTH === undefined) delete process.env.ALLOW_ENV_AUTH;
  });

  it('rechaza anónimos y registro público', async () => {
    await request(app.getHttpServer()).get('/api/v1/protected').expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ username: 'intruso', password: 'another-password', role: 'admin' }).expect(401);
  });

  it('valida el body sin aceptar campos extra', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operador', password: 'correct-password', role: 'admin' }).expect(400);
  });

  it('permite sesión válida, restringe admin, no expone hash y revoca al salir', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operador', password: 'correct-password' }).expect(201);
    const auth = `Bearer ${login.body.access_token}`;
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', auth).expect(200);
    expect(me.body).toEqual({ idUser: 1, username: 'operador', role: 'user', isActive: true });
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['x-request-id']).toBeTruthy();
    await request(app.getHttpServer()).get('/api/v1/protected/admin').set('Authorization', auth).expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', auth).expect(201);
    await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', auth).expect(401);
  });

  it('revoca una sesión activa cuando se desactiva la cuenta', async () => {
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operador', password: 'correct-password' }).expect(201);
    user.isActive = false;
    await request(app.getHttpServer()).get('/api/v1/protected').set('Authorization', `Bearer ${login.body.access_token}`).expect(401);
  });

  it('limita los intentos de login por IP', async () => {
    for (let i = 0; i < 2; i++) await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operador', password: 'bad-password' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'operador', password: 'bad-password' }).expect(429);
  });
});
