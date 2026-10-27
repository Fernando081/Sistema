import { EntityManager } from 'typeorm';
import { queryRows } from './typed-query';

/** El llamador bloquea el producto y registra su Kardex dentro de la misma transacción. */
export async function updateManagedStock(
  manager: EntityManager,
  idProducto: number,
  existencia: number,
  locationAlreadyUpdated = false,
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('El movimiento gestionado requiere una transacción activa');
  const [settings] = await queryRows<{
    managed: string | null;
    skip: string | null;
  }>(
    manager,
    "SELECT current_setting('app.stock_movement_managed',true) AS managed,current_setting('app.skip_location_stock_sync',true) AS skip",
  );
  await manager.query(
    "SELECT set_config('app.stock_movement_managed','true',true)",
  );
  if (locationAlreadyUpdated)
    await manager.query(
      "SELECT set_config('app.skip_location_stock_sync','true',true)",
    );
  await manager.query(
    'UPDATE producto SET "Existencia"=$2 WHERE "IdProducto"=$1',
    [idProducto, existencia],
  );
  await manager.query(
    "SELECT set_config('app.stock_movement_managed',$1,true)",
    [settings?.managed || 'false'],
  );
  if (locationAlreadyUpdated)
    await manager.query(
      "SELECT set_config('app.skip_location_stock_sync',$1,true)",
      [settings?.skip || 'false'],
    );
}
