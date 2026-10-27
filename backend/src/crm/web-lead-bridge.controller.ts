import { Body, Controller, Header, Headers, Post, Req, Res, ServiceUnavailableException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { CrmSolicitudesWebService, ValidatedWebLead } from './crm-solicitudes-web.service';
import { bridgeConfig, transportKey } from './web-lead-bridge.config';

@Controller('web-lead-bridge')
export class WebLeadBridgeController {
  constructor(private readonly inbox: CrmSolicitudesWebService) {}
  private authenticate(body: unknown, timestamp: string, signature: string, req: Request, check = false) {
    if(process.env.WEB_LEAD_BRIDGE_ENABLED !== 'true')
      throw new ServiceUnavailableException('Recepción no disponible');
    const config = bridgeConfig();
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
      !/^\d{13}$/.test(timestamp || '') || Math.abs(Date.now()-Number(timestamp))>60000 || !/^[a-f0-9]{64}$/.test(signature || ''))
      throw new UnauthorizedException('Solicitud de servicio inválida');
    if(!body || typeof body!=='object' || Array.isArray(body)) throw new BadRequestException('Solicitud inválida');
    const raw=JSON.stringify(body);
    if(Buffer.byteLength(raw)>16384) throw new BadRequestException('Solicitud inválida');
    const id = req.headers['x-web-key-id'];
    const key = transportKey(config, id, Number(timestamp));
    if (check && (config.mode !== 'v2' || id !== config.keyId)) throw new UnauthorizedException('Solicitud de servicio inválida');
    const domain = check ? `web-lead-check-v2\n${config.keyId}\n${timestamp}\n${raw}` :
      typeof id === 'string' ? `web-lead-v2\n${id}\n${timestamp}\n${raw}` : `web-lead-v1\n${timestamp}\n${raw}`;
    const expected=createHmac('sha256',key).update(domain).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature,'hex'))) throw new UnauthorizedException('Solicitud de servicio inválida');
    return config;
  }
  // Read-only handshake: no contact, database query, lead insertion or conversion.
  @Public() @Post('check')
  @Header('Cache-Control', 'no-store')
  check(@Body() body: {schemaVersion:number;nonce:string;privacyVersion:string;fingerprintProof:string},
    @Headers('x-web-timestamp') timestamp: string, @Headers('x-web-signature') signature: string,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const config = this.authenticate(body, timestamp, signature, req, true);
    if (Object.keys(body).sort().join(',') !== 'fingerprintProof,nonce,privacyVersion,schemaVersion' ||
      body.schemaVersion !== 1 || typeof body.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(body.nonce) ||
      body.privacyVersion !== config.policy || typeof body.fingerprintProof !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprintProof))
      throw new BadRequestException('Solicitud inválida');
    const proof = createHmac('sha256',config.fingerprintKey).update(`web-lead-fingerprint-check-v1\n${body.nonce}\n${body.privacyVersion}`).digest();
    if (!timingSafeEqual(proof,Buffer.from(body.fingerprintProof,'hex'))) throw new BadRequestException('Solicitud inválida');
    const receipt = { checked: true, nonce: body.nonce, privacyVersion: config.policy, inboxDays: 90 };
    res.setHeader('X-Web-Timestamp',timestamp);
    res.setHeader('X-Web-Signature',createHmac('sha256',config.key)
      .update(`web-lead-check-response-v2\n${config.keyId}\n${timestamp}\n${JSON.stringify(receipt)}`).digest('hex'));
    return receipt;
  }
  // Dedicated signed service endpoint: bypasses JWT but never signature/config checks.
  @Public() @Post()
  receive(@Body() body: {lead:ValidatedWebLead;fingerprint:string},
    @Headers('x-web-timestamp') timestamp: string, @Headers('x-web-signature') signature: string,
    @Req() req: Request) {
    const config = this.authenticate(body, timestamp, signature, req);
    const policy = config.policy;
    const lead=body.lead;
    if(Object.keys(body).sort().join(',')!=='fingerprint,lead' || !lead || lead.schemaVersion!==1 || lead.origin!=='public-web' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(lead.requestId) ||
      lead.privacy?.accepted!==true || lead.privacy.version!==policy || !Array.isArray(lead.items) || lead.items.length<1 || lead.items.length>10 ||
      !/^[a-f0-9]{64}$/.test(body.fingerprint || '')) throw new BadRequestException('Solicitud inválida');
    const validText=(value: unknown,max:number,empty=false) => typeof value==='string' && value.length<=max && (empty || !!value.trim()) && ![...value].some(char => char.charCodeAt(0)<32 || char.charCodeAt(0)===127);
    const exact=(value:unknown,keys:string[]) => !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===keys.sort().join(',');
    if(!exact(lead,['schemaVersion','requestId','origin','contact','items','privacy']) || !exact(lead.contact,['name','channel','value']) ||
      !exact(lead.privacy,['accepted','version']) || !validText(lead.contact.name,120) || !validText(lead.contact.value,254) ||
      !['email','phone','whatsapp'].includes(lead.contact.channel) ||
      !(lead.contact.channel==='email' ? /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(lead.contact.value) : /^\+[1-9][0-9]{7,14}$/.test(lead.contact.value)) ||
      lead.items.some(item => !item || !['catalog','reference'].includes(String(item.kind)) ||
        !exact(item,item.kind==='catalog'?['kind','slug','code','brand','quantity']:['kind','code','brand','application','quantity']) ||
        !validText(item.code,item.kind==='catalog'?200:100) || !validText(item.brand,item.kind==='catalog'?200:100,true) || !Number.isInteger(item.quantity) || Number(item.quantity)<1 || Number(item.quantity)>9999 ||
        (item.kind==='catalog' ? !validText(item.slug,160) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item.slug)) : !validText(item.application,200,true))))
      throw new BadRequestException('Solicitud inválida');
    const payload:Record<string,unknown>={...lead}; delete payload.requestId;
    const hash=createHmac('sha256',config.fingerprintKey).update(JSON.stringify(payload)).digest();
    if(!timingSafeEqual(hash,Buffer.from(body.fingerprint,'hex'))) throw new BadRequestException('Solicitud inválida');
    return this.inbox.receive(lead,body.fingerprint);
  }
}
