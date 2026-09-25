import { DataSource } from 'typeorm';
import { NotificationService } from './notification.service';

describe('Centro de notificaciones operativas', () => {
  it('genera fuentes deduplicadas y limpia alertas que dejaron de aplicar', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const source = { transaction: (work: (manager: { query: jest.Mock }) => unknown) => work({ query }) };
    const service = new NotificationService(source as unknown as DataSource);

    await service.refreshOperationalAlerts();

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain("'quote_expiring'");
    expect(sql).toContain("'collection_overdue'");
    expect(sql).toContain("'warranty_due'");
    expect(sql).toContain("'critical_stock'");
    expect(sql).toContain('ON CONFLICT(dedupe_key) DO UPDATE');
    expect(sql).toContain('read_at=coalesce');
  });
});
