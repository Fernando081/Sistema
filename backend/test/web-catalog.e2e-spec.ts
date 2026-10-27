import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { WebCatalogController } from '../src/web-catalog/web-catalog.controller';
import { WebCatalogService } from '../src/web-catalog/web-catalog.service';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
describe('HTTP de preparación web: acceso y validación', () => {
  let app: INestApplication;
  const preview = jest.fn().mockResolvedValue({ ficha: null });
  const save = jest.fn().mockResolvedValue({ version: 1, estado: 'borrador' });
  const list = jest.fn().mockResolvedValue({ data: [], total: 0 });
  const approveBatch = jest
    .fn()
    .mockResolvedValue({ scope: 'No activa sitio' });
  const approvalStatus = jest.fn().mockResolvedValue({ active: false });
  const batchStatus = jest.fn().mockResolvedValue({ active: false });
  const revokeBatch = jest.fn().mockResolvedValue({ revoked: true });
  const revokeApproval = jest.fn().mockResolvedValue({ revoked: true });
  const approveCandidate = jest
    .fn()
    .mockResolvedValue({ scope: 'No activa sitio' });
  const exportCandidate = jest
    .fn()
    .mockResolvedValue({ schemaVersion: 1, products: [] });
  const body = {
    slug: 'filtro-prueba',
    titulo: 'Filtro de combustible',
    descripcion: 'Descripción revisada de la ficha comercial del producto.',
    estado: 'borrador',
    version: 0,
    datosRealesConfirmados: false,
    derechosImagenConfirmados: false,
    compatibilidadVerificada: false,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebCatalogController],
      providers: [
        {
          provide: WebCatalogService,
          useValue: {
            preview,
            save,
            list,
            exportCandidate,
            approveCandidate,
            approveBatch,
            approvalStatus,
            batchStatus,
            revokeBatch,
            revokeApproval,
          },
        },
        {
          provide: AuthService,
          useValue: {
            authenticate: (token: string) =>
              Promise.resolve({ idUser: 1, role: token }),
          },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('protege lista y valida paginación/filtros', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products')
      .set('Authorization', 'Bearer user')
      .expect(403);
    for (const query of ['limit=1000', 'page=-1', 'estado=publicado'])
      await request(app.getHttpServer())
        .get('/api/v1/web-catalog/admin/products?' + query)
        .set('Authorization', 'Bearer admin')
        .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products?page=2&estado=borrador')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 25, estado: 'borrador' }),
    );
  });
  it('no permite lectura anónima ni operador', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products/1')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products/1')
      .set('Authorization', 'Bearer user')
      .expect(403);
    expect(preview).not.toHaveBeenCalled();
  });
  it('protege la exportación: sin sesión, sin rol y con rol administrador', async () => {
    const route = '/api/v1/web-catalog/admin/products/1/export-candidate';
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer user')
      .expect(403);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(exportCandidate).toHaveBeenCalledTimes(1);
    expect(exportCandidate).toHaveBeenCalledWith(1);
  });
  it('aprobación exige administrador y DTO válido', async () => {
    const route = '/api/v1/web-catalog/admin/products/1/approve-candidate';
    await request(app.getHttpServer())
      .post(route)
      .send({ version: 1, confirmed: true })
      .expect(401);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer user')
      .send({ version: 1, confirmed: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer admin')
      .send({ version: 0, confirmed: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer admin')
      .send({ version: 1, confirmed: true })
      .expect(201);
    expect(approveCandidate).toHaveBeenCalledWith(1, 1, true, 1);
  });
  it('protege vigencia y revocación administrativa', async () => {
    const route = '/api/v1/web-catalog/admin/products/1/approvals/9';
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer user')
      .expect(403);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer user')
      .send({ confirmed: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer admin')
      .send({ confirmed: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer admin')
      .send({ confirmed: true })
      .expect(201);
    expect(revokeApproval).toHaveBeenCalledWith(1, 9, true, 1);
  });
  it('protege aprobación de lote y valida miembros', async () => {
    const route = '/api/v1/web-catalog/admin/products/batch/approve';
    const body = {
      raw: '{}',
      members: [{ productId: 1, version: 1 }],
      confirmed: true,
    };
    await request(app.getHttpServer()).post(route).send(body).expect(401);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer user')
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer admin')
      .send({ ...body, members: [{ productId: 0, version: 1 }] })
      .expect(400);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', 'Bearer admin')
      .send(body)
      .expect(201);
    expect(approveBatch).toHaveBeenCalledWith('{}', body.members, true, 1);
  });
  it('protege consulta y revocación de lote', async () => {
    const route = '/api/v1/web-catalog/admin/products/batch/approvals/9';
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer user')
      .expect(403);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer user')
      .send({ confirmed: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer admin')
      .send({ confirmed: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .post(route + '/revoke')
      .set('Authorization', 'Bearer admin')
      .send({ confirmed: true })
      .expect(201);
    expect(batchStatus).toHaveBeenCalledWith(9);
    expect(revokeBatch).toHaveBeenCalledWith(9, true, 1);
  });
  it('permite vista administrativa', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/web-catalog/admin/products/1')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(preview).toHaveBeenCalledWith(1);
  });
  it('rechaza escritura sin rol administrador', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/web-catalog/admin/products/1')
      .set('Authorization', 'Bearer user')
      .send(body)
      .expect(403);
    expect(save).not.toHaveBeenCalled();
  });
  it('rechaza campos privados y contenido HTML', async () => {
    for (const patch of [
      { costo: 10 },
      { titulo: '<script>alert(1)</script>' },
      { version: -1 },
      { imagenes: ['/uploads/../secret.png'] },
      {
        especificaciones: [
          { nombre: 'Altura', valor: '10', unidad: 'mm', costo: 20 },
        ],
      },
    ]) {
      await request(app.getHttpServer())
        .put('/api/v1/web-catalog/admin/products/1')
        .set('Authorization', 'Bearer admin')
        .send({ ...body, ...patch })
        .expect(400);
    }
    expect(save).not.toHaveBeenCalled();
  });
  it('guarda un borrador validado con autor persistido', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/web-catalog/admin/products/1')
      .set('Authorization', 'Bearer admin')
      .send(body)
      .expect(200);
    expect(save).toHaveBeenCalledWith(1, expect.objectContaining(body), 1);
  });
});
