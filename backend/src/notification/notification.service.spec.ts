import { DataSource } from 'typeorm';
import { NotificationService } from './notification.service';
import { Logger } from '@nestjs/common';

describe('Centro de notificaciones operativas', () => {
  it('permite leer avisos existentes si falla la revisión bajo demanda', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ idNotification: 1, title: 'Aviso existente' }])
      .mockResolvedValueOnce([{ unread: 1 }]);
    const service = new NotificationService({
      transaction: jest.fn().mockRejectedValue(new Error('private-sql-detail')),
      query,
    } as unknown as DataSource);
    try {
      const result = await service.list(9);
      expect(result.unread).toBe(1);
      expect(result.items[0].title).toBe('Aviso existente');
      expect(query.mock.calls[0][1]).toEqual([9]);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'private-sql-detail',
      );
    } finally {
      errorLog.mockRestore();
    }
  });
  it('genera fuentes deduplicadas y limpia alertas que dejaron de aplicar', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const source = {
      transaction: (work: (manager: { query: jest.Mock }) => unknown) =>
        work({ query }),
    };
    const service = new NotificationService(source as unknown as DataSource);

    await service.refreshOperationalAlerts();

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain("'quote_expiring'");
    expect(sql).toContain("'collection_overdue'");
    expect(sql).toContain("'warranty_due'");
    expect(sql).toContain("'critical_stock'");
    expect(sql).toContain('ON CONFLICT(dedupe_key) DO UPDATE');
    expect(sql).toContain('read_at=coalesce');
  });
  it('revisa jobs aunque falle la generación comercial y conserva la lectura por usuario', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const jobQuery = jest.fn().mockResolvedValue([{ locked: true }]);
    const transaction = jest.fn()
      .mockRejectedValueOnce(new Error('private-business-failure'))
      .mockImplementationOnce((work: (manager: { query: jest.Mock }) => Promise<void>) => work({ query: jobQuery }));
    const query = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ unread: 0 }]);
    try {
      const result = await new NotificationService({ transaction,query } as unknown as DataSource).list(9);
      expect(result.unread).toBe(0);
      expect(jobQuery.mock.calls[2][0]).toContain('scheduled_job_failed');
      expect(query.mock.calls[0][1]).toEqual([9]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-business-failure');
    } finally {log.mockRestore();}
  });
});
