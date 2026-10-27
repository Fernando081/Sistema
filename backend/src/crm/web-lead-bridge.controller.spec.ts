import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import request from 'supertest';
import { WebLeadBridgeController } from './web-lead-bridge.controller';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';
import { bridgeEnvironmentKeys } from './web-lead-bridge.config';

describe('Comprobación firmada sin persistencia', () => {
  let app: INestApplication;
  const signing = randomBytes(32), fingerprint = randomBytes(32);
  const inbox = { receive: jest.fn() };
  const saved = Object.fromEntries(bridgeEnvironmentKeys.map(key => [key, process.env[key]]));
  beforeAll(async () => {
    for (const field of bridgeEnvironmentKeys) delete process.env[field];
    Object.assign(process.env, { WEB_LEAD_BRIDGE_ENABLED: 'true', WEB_LEAD_BRIDGE_KEY_ID: 'fixture-active',
      WEB_LEAD_BRIDGE_KEY: signing.toString('base64'), WEB_LEAD_FINGERPRINT_KEY: fingerprint.toString('base64'), WEB_LEAD_PRIVACY_VERSION: 'fixture-v1' });
    const module = await Test.createTestingModule({ controllers: [WebLeadBridgeController],
      providers: [{ provide: CrmSolicitudesWebService, useValue: inbox }] }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const body = () => {
    const nonce = randomBytes(32).toString('hex');
    return { schemaVersion: 1, nonce, privacyVersion: 'fixture-v1', fingerprintProof: createHmac('sha256',fingerprint)
      .update(`web-lead-fingerprint-check-v1\n${nonce}\nfixture-v1`).digest('hex') };
  };
  const post = (data: object, purpose = 'web-lead-check-v2', id = 'fixture-active', timestamp = String(Date.now())) =>
    request(app.getHttpServer()).post('/web-lead-bridge/check')
      .set('X-Web-Key-Id', id).set('X-Web-Timestamp', timestamp)
      .set('X-Web-Signature', createHmac('sha256',signing).update(`${purpose}\n${id}\n${timestamp}\n${JSON.stringify(data)}`).digest('hex')).send(data);
  it('firma nonce/versión/retención en recibo sin invocar almacenamiento', async () => {
    const data = body(), timestamp = String(Date.now());
    const response = await post(data, 'web-lead-check-v2', 'fixture-active', timestamp).expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ checked: true, nonce: data.nonce, privacyVersion: 'fixture-v1', inboxDays: 90 });
    expect(response.headers['x-web-signature']).toBe(createHmac('sha256',signing)
      .update(`web-lead-check-response-v2\nfixture-active\n${timestamp}\n${response.text}`).digest('hex'));
    expect(inbox.receive).not.toHaveBeenCalled();
  });
  it('rechaza solicitudes sin firma, propósito/ID equivocado, fecha vieja y cierre explícito', async () => {
    await request(app.getHttpServer()).post('/web-lead-bridge/check').send({}).expect(401);
    await post(body(), 'web-lead-v2').expect(401);
    await post(body(), 'web-lead-check-v2', 'unknown').expect(401);
    await post(body(), 'web-lead-check-v2', 'fixture-active', String(Date.now()-120000)).expect(401);
    process.env.WEB_LEAD_BRIDGE_ENABLED = 'false';
    try { await post(body()).expect(503); } finally { process.env.WEB_LEAD_BRIDGE_ENABLED = 'true'; }
    expect(inbox.receive).not.toHaveBeenCalled();
  });
  it('rechaza aviso/huella/contactos/campos extra y evita usar la comprobación para guardar', async () => {
    for (const data of [{ ...body(), privacyVersion: 'other' }, { ...body(), nonce: 'invalid' },
      { ...body(), fingerprintProof: 'a'.repeat(64) }, { ...body(), contact: { name: 'No admitir' } }])
      await post(data).expect(400);
    const data = body(), timestamp = String(Date.now());
    await request(app.getHttpServer()).post('/web-lead-bridge').set('X-Web-Key-Id', 'fixture-active').set('X-Web-Timestamp', timestamp)
      .set('X-Web-Signature', createHmac('sha256', signing).update(`web-lead-check-v2\nfixture-active\n${timestamp}\n${JSON.stringify(data)}`).digest('hex'))
      .send(data).expect(401);
    expect(inbox.receive).not.toHaveBeenCalled();
  });
});
