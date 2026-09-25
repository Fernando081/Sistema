import { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service';

describe('Refresco de métricas', () => {
  it('invoca la función SQL y libera el mismo bloqueo/conexión', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ locked: true }]).mockResolvedValue([]);
    const runner = { connect: jest.fn(), query, release: jest.fn() };
    await new DashboardService({ createQueryRunner: () => runner } as unknown as DataSource).refreshMaterializedViews();
    expect(query.mock.calls.map(call => call[0])).toEqual([
      'SELECT pg_try_advisory_lock(72410, 1) AS locked', 'SELECT sp_refresh_analytics_views()', 'SELECT pg_advisory_unlock(72410, 1)',
    ]);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('evita refrescos paralelos entre instancias', async () => {
    const query = jest.fn().mockResolvedValue([{ locked: false }]);
    const runner = { connect: jest.fn(), query, release: jest.fn() };
    await new DashboardService({ createQueryRunner: () => runner } as unknown as DataSource).refreshMaterializedViews();
    expect(query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
