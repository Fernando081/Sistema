import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';

@Injectable()
export class CrmSolicitudesWebMaintenance {
  private readonly logger = new Logger(CrmSolicitudesWebMaintenance.name);
  private readonly enabled = process.env.WEB_INBOX_PURGE_ENABLED === 'true';
  private running = false;
  private last: { finishedAt: string; result: 'passed' | 'failed'; purged: number | null } | null = null;
  constructor(private readonly inbox: CrmSolicitudesWebService) {}

  status() { return { enabled: this.enabled, running: this.running, lastRun: this.last,
    schedule: 'Cada hora, minuto 15; hasta 1000 registros por ejecución',
    scope: 'Estado en memoria de este proceso; no incluye purga manual ni otros servidores' }; }

  @Cron('0 15 * * * *')
  async run() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.inbox.purgeExpired();
      this.last = { finishedAt: new Date().toISOString(), result: 'passed', purged: result.purged };
    } catch {
      this.last = { finishedAt: new Date().toISOString(), result: 'failed', purged: null };
      this.logger.error('Falló la purga programada de bandeja web. Revisa el estado y la conexión local.');
    } finally { this.running = false; }
  }
}
