import { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service';
import { Logger } from '@nestjs/common';

describe('Refresco de métricas', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());
  it('avisa ante fallo y libera bloqueo aun si no puede persistir la alerta', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('secret database detail'))
      .mockResolvedValue([]);
    const runner = { connect: jest.fn(), query, release: jest.fn() };
    const notificationQuery = jest.fn().mockRejectedValue(new Error('offline'));
    await new DashboardService({
      createQueryRunner: () => runner,
      query: notificationQuery,
    } as unknown as DataSource).refreshMaterializedViews();
    expect(notificationQuery.mock.calls[0][0]).toContain(
      'INSERT INTO app_notification',
    );
    expect(query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock(72410, 1)',
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(
      query.mock.calls.some((call) =>
        String(call[0]).includes("status='failed'"),
      ),
    ).toBe(true);
    expect(
      JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls),
    ).not.toContain('secret');
  });
  it('resuelve alertas solo tras refresco exitoso', async () => {
    const runner = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([{ locked: true }]),
      release: jest.fn(),
    };
    const query = jest.fn().mockResolvedValue([]);
    await new DashboardService({
      createQueryRunner: () => runner,
      query,
    } as unknown as DataSource).refreshMaterializedViews();
    expect(query.mock.calls[0][0]).toContain('UPDATE app_notification');
  });
  it('no resuelve alertas cuando otra instancia tiene el bloqueo', async () => {
    const runner = {
      connect: jest.fn(),
      query: jest.fn().mockResolvedValue([{ locked: false }]),
      release: jest.fn(),
    };
    const query = jest.fn();
    await new DashboardService({
      createQueryRunner: () => runner,
      query,
    } as unknown as DataSource).refreshMaterializedViews();
    expect(query).not.toHaveBeenCalled();
  });
  it('invoca la función SQL y libera el mismo bloqueo/conexión', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValue([]);
    const runner = { connect: jest.fn(), query, release: jest.fn() };
    await new DashboardService({
      createQueryRunner: () => runner,
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource).refreshMaterializedViews();
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'SELECT pg_try_advisory_lock(72410, 1) AS locked',
      "INSERT INTO operational_job_run(id,job_name,status) VALUES ($1,'dashboard_refresh','running')",
      'SELECT sp_refresh_analytics_views()',
      "UPDATE operational_job_run SET status='success',finished_at=clock_timestamp() WHERE id=$1",
      'SELECT pg_advisory_unlock(72410, 1)',
    ]);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('evita refrescos paralelos entre instancias', async () => {
    const query = jest.fn().mockResolvedValue([{ locked: false }]);
    const runner = { connect: jest.fn(), query, release: jest.fn() };
    await new DashboardService({
      createQueryRunner: () => runner,
      query: jest.fn().mockResolvedValue([]),
    } as unknown as DataSource).refreshMaterializedViews();
    expect(query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
