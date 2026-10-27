import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

export async function supplierRequest<T>(
  manager: EntityManager,
  key: string,
  type: string,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const requestId = key.toLowerCase();
  const hash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'supplier-request:' + requestId,
  ]);
  const previous = await queryRows<{
    operation_type: string;
    payload_hash: string;
    response: T;
  }>(
    manager,
    'SELECT operation_type,payload_hash,response FROM operation_idempotency WHERE request_id=$1',
    [requestId],
  );
  if (previous.length) {
    if (
      previous[0].operation_type !== type ||
      previous[0].payload_hash !== hash
    )
      throw new ConflictException(
        'El identificador de reintento ya fue usado con datos diferentes',
      );
    return previous[0].response;
  }
  const response = await run();
  await manager.query(
    'INSERT INTO operation_idempotency(request_id,operation_type,payload_hash,response) VALUES($1,$2,$3,$4::jsonb)',
    [requestId, type, hash, JSON.stringify(response)],
  );
  return response;
}
