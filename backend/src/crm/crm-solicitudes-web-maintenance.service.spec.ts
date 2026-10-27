import { Logger } from '@nestjs/common';
import { CrmSolicitudesWebMaintenance } from './crm-solicitudes-web-maintenance.service';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';

describe('Mantenimiento de bandeja web', () => {
  const previous = process.env.WEB_INBOX_PURGE_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.WEB_INBOX_PURGE_ENABLED;
    else process.env.WEB_INBOX_PURGE_ENABLED = previous;
    jest.restoreAllMocks();
  });
  it('permanece desactivado sin configuración explícita', async () => {
    delete process.env.WEB_INBOX_PURGE_ENABLED;
    const purgeExpired = jest.fn();
    const job = new CrmSolicitudesWebMaintenance({ purgeExpired } as unknown as CrmSolicitudesWebService);
    await job.run();
    expect(purgeExpired).not.toHaveBeenCalled();
    expect(job.status().enabled).toBe(false);
  });
  it('impide solapamiento y registra éxito sin datos de contactos', async () => {
    process.env.WEB_INBOX_PURGE_ENABLED = 'true';
    let finish!: (value: {purged:number}) => void;
    const purgeExpired = jest.fn(() => new Promise<{purged:number}>(resolve => { finish = resolve; }));
    const job = new CrmSolicitudesWebMaintenance({ purgeExpired } as unknown as CrmSolicitudesWebService);
    const first = job.run();
    await job.run();
    expect(purgeExpired).toHaveBeenCalledTimes(1);
    expect(job.status().running).toBe(true);
    finish({purged:3}); await first;
    expect(job.status().lastRun).toMatchObject({result:'passed',purged:3});
    expect(job.status().running).toBe(false);
  });
  it('registra fallo sin mensaje de excepción y permite nueva ejecución', async () => {
    process.env.WEB_INBOX_PURGE_ENABLED = 'true';
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const purgeExpired = jest.fn().mockRejectedValueOnce(new Error('dato privado')).mockResolvedValueOnce({purged:0});
    const job = new CrmSolicitudesWebMaintenance({ purgeExpired } as unknown as CrmSolicitudesWebService);
    await job.run();
    expect(job.status().lastRun).toMatchObject({result:'failed',purged:null});
    expect(JSON.stringify(job.status())).not.toContain('dato privado');
    await job.run();
    expect(job.status().lastRun).toMatchObject({result:'passed',purged:0});
  });
});
