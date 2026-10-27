import { DataSource } from 'typeorm';
import { runScheduledJob } from './scheduled-job';

function setup(locked = true) {
  const runner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    isTransactionActive: true,
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn().mockResolvedValue([{ locked }]),
  };
  const query = jest.fn().mockResolvedValue([]);
  const alertQuery = jest.fn().mockResolvedValue([{ locked: true }]);
  const transaction = jest.fn(async (work: (manager: { query: jest.Mock }) => Promise<void>) => work({ query: alertQuery }));
  const source = {
    createQueryRunner: () => runner,
    query,
    transaction,
  } as unknown as DataSource;
  return { runner, query, source, transaction };
}
describe('Historial de jobs programados', () => {
  it('registra inicio/éxito y libera la transacción de guardia', async () => {
    const { source, query, runner } = setup();
    const work = jest.fn().mockResolvedValue(undefined);
    expect(
      await runScheduledJob(source, 'operational_alerts', work, jest.fn()),
    ).toBe('success');
    expect(query.mock.calls[0][1][1]).toBe('operational_alerts');
    expect(query.mock.calls[1][0]).toContain("status='success'");
    expect(query.mock.calls[0][1][0]).toBe(query.mock.calls[1][1][0]);
    expect(work).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('omite sin generar un intento cuando otra instancia tiene el bloqueo', async () => {
    const { source, query, runner, transaction } = setup(false);
    const work = jest.fn();
    expect(
      await runScheduledJob(source, 'operational_alerts', work, jest.fn()),
    ).toBe('skipped');
    expect(query).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('una caída de notificaciones no convierte el trabajo exitoso en fallo', async () => {
    const { source, query, transaction } = setup();
    transaction.mockRejectedValueOnce(new Error('private-alert-error'));
    const report = jest.fn();
    await expect(runScheduledJob(source, 'operational_alerts', async () => {}, report)).resolves.toBe('success');
    expect(query.mock.calls[1][0]).toContain("status='success'");
    expect(report).toHaveBeenCalledWith('No se pudieron revisar avisos de procesos automáticos');
    expect(JSON.stringify(report.mock.calls)).not.toContain('private-alert-error');
  });
  it('conserva fallo/cierre sin persistir el detalle del error', async () => {
    const { source, query, runner } = setup();
    const error = new Error('private-sql-value');
    await expect(
      runScheduledJob(
        source,
        'dashboard_freshness',
        async () => {
          throw error;
        },
        jest.fn(),
      ),
    ).rejects.toBe(error);
    expect(query.mock.calls[1][0]).toContain("status='failed'");
    expect(JSON.stringify(query.mock.calls)).not.toContain('private-sql-value');
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('no ejecuta trabajo sin poder persistir el inicio', async () => {
    const { source, query, runner } = setup();
    query.mockRejectedValueOnce(new Error('offline'));
    const work = jest.fn();
    await expect(
      runScheduledJob(source, 'dashboard_freshness', work, jest.fn()),
    ).rejects.toThrow('offline');
    expect(work).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('libera recursos y reporta sin detalles si no puede cerrar el fallo', async () => {
    const { source, query, runner } = setup();
    query
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('private-store-error'));
    const report = jest.fn();
    await expect(
      runScheduledJob(
        source,
        'operational_alerts',
        async () => {
          throw new Error('work');
        },
        report,
      ),
    ).rejects.toThrow('work');
    expect(report).toHaveBeenCalledWith(
      'No se pudo cerrar el registro del job programado',
    );
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
