import { DataSource } from 'typeorm';
import { syncScheduledJobAlerts } from './scheduled-job-alerts';

describe('Avisos de procesos automáticos', () => {
  it('usa guardia transaccional y no modifica avisos si otra instancia revisa', async () => {
    const query = jest.fn().mockResolvedValue([{ locked: false }]);
    const transaction = jest.fn(
      async (work: (manager: { query: jest.Mock }) => Promise<void>) =>
        work({ query }),
    );
    await syncScheduledJobAlerts({ transaction } as unknown as DataSource);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("statement_timeout='5s'");
    expect(query.mock.calls[1][0]).toContain(
      'pg_try_advisory_xact_lock(72410,4)',
    );
  });

  it('propaga falla sin convertirla en registro de ejecución', async () => {
    const transaction = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(
      syncScheduledJobAlerts({ transaction } as unknown as DataSource),
    ).rejects.toThrow('offline');
  });
});
