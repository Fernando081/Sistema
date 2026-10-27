import { QueryExecutor } from '../common/database/typed-query';

// Solo dentro de una transacción: evita dejar el actor en conexiones reutilizadas.
export async function setAuditActor(manager:QueryExecutor,id:number|undefined):Promise<void>{
  if(Number.isSafeInteger(id)&&Number(id)>0&&Number(id)<=2147483647)
    await manager.query("SELECT set_config('app.current_user_id',$1,true)",[String(id)]);
}
