import { ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor, queryRows } from '../common/database/typed-query';

// Siempre dentro de la transacción de escritura. Orden: política -> actor -> solicitud.
export async function commercialActor(executor:QueryExecutor,actor:JwtPayload|undefined,permission?:string,exclusive=false){
  await executor.query(exclusive
    ? "SELECT pg_advisory_xact_lock(hashtext('commercial-approvals'))"
    : "SELECT pg_advisory_xact_lock_shared(hashtext('commercial-approvals'))");
  const users=await queryRows<{id_user:number}>(executor,`SELECT id_user FROM auth_user
    WHERE id_user=$1 AND is_active AND token_version=$2 AND role=$4
      AND ($3::text IS NULL OR fn_effective_permission(id_user,role,$3))
    FOR SHARE`,[actor?.idUser??null,actor?.version??null,permission??null,actor?.role??null]);
  if(!users.length)throw new ForbiddenException('Tu cuenta o permiso comercial cambió. Inicia sesión nuevamente.');
  await setAuditActor(executor,users[0].id_user);
  return users[0].id_user;
}
