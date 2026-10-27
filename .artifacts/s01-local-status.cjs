const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('../node_modules/pg');
const {databaseConfig}=require('../backend/db-config');
async function main(){
  assert.equal(process.versions.node.split('.')[0],'24');
  const checks=[];
  for(const [url,status] of [
    ['http://127.0.0.1:3100/api/v1/health',200],
    ['http://127.0.0.1:3100/api/v1/auth/access-profiles',401],
    ['http://127.0.0.1:3100/api/v1/auth/permission-catalog',401],
    ['http://127.0.0.1:4300/usuarios',200],
    ['http://127.0.0.1:4500/',200],
    ['http://127.0.0.1:4600/catalogo',200],
    ['http://127.0.0.1:4500/solicitar',503],
    ['http://127.0.0.1:4600/solicitar',503]]){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);
    await response.arrayBuffer();checks.push({url,status,passed:true});
  }
  const client=new Client(databaseConfig());await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    assert.equal((await client.query("SELECT count(*)::int n FROM schema_migration WHERE filename='094_roles_personalizados.sql'")).rows[0].n,1);
    assert.equal((await client.query('SELECT count(*)::int n FROM app_access_profile')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM app_user_access_profile')).rows[0].n,0);
    assert.equal((await client.query(`SELECT count(*)::int n FROM auth_user u CROSS JOIN app_permission p
      WHERE fn_effective_permission(u.id_user,u.role,p.code) IS DISTINCT FROM COALESCE(
        (SELECT granted FROM app_user_permission WHERE id_user=u.id_user AND permission_code=p.code),
        EXISTS(SELECT 1 FROM app_role_permission WHERE role=u.role AND permission_code=p.code))`)).rows[0].n,0);
    checks.push({name:'094 aplicada; ningún perfil/asignación de ejemplo y mismos permisos efectivos previos para todas las cuentas',passed:true});
    await client.query('ROLLBACK');
  }finally{await client.end();}
  fs.writeFileSync('.artifacts/s01-local-status.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks},null,2)+'\n');
  console.log('S01: '+checks.length+' verificaciones locales aprobadas; SQL solo lectura.');
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});
