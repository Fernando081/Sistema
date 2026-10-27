const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
async function main(){
  assert.equal(process.versions.node.split('.')[0],'24');const checks=[];
  for(const [url,status]of [
    ['http://127.0.0.1:3100/api/v1/health',200],
    ['http://127.0.0.1:3100/api/v1/auth/sessions',401],
    ['http://127.0.0.1:3100/api/v1/auth/access-profiles',401],
    ['http://127.0.0.1:4300/perfil',200],
    ['http://127.0.0.1:4500/',200],
    ['http://127.0.0.1:4600/catalogo',200],
    ['http://127.0.0.1:4500/solicitar',503],
    ['http://127.0.0.1:4600/solicitar',503]]){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);await response.arrayBuffer();checks.push({url,status,passed:true});
  }
  const client=new Client(databaseConfig());await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    assert.equal((await client.query("SELECT count(*)::int n FROM schema_migration WHERE filename='095_sesiones_por_navegador.sql'")).rows[0].n,1);
    const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='auth_session'")).rows.map(row=>row.column_name);
    assert.deepEqual(columns.sort(),['client_label','created_at','expires_at','id_session','id_user','last_seen_at','revoked_at','token_version'].sort());
    assert.equal((await client.query(`SELECT count(*)::int n FROM auth_user u CROSS JOIN app_permission p
      WHERE fn_effective_permission(u.id_user,u.role,p.code) IS DISTINCT FROM COALESCE(
        (SELECT granted FROM app_user_permission WHERE id_user=u.id_user AND permission_code=p.code),
        (SELECT EXISTS(SELECT 1 FROM app_access_profile_permission pp WHERE pp.id_profile=a.id_profile AND pp.permission_code=p.code)
          FROM app_user_access_profile a WHERE a.id_user=u.id_user AND u.role='user'),
        EXISTS(SELECT 1 FROM app_role_permission WHERE role=u.role AND permission_code=p.code))`)).rows[0].n,0);
    await client.query('ROLLBACK');checks.push({name:'095 registrada; tabla sin tokens/IP/User-Agent completo y permisos S01 conservados',passed:true});
  }finally{await client.end();}
  fs.writeFileSync('.artifacts/s021-local-status.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks},null,2)+'\n');console.log(checks.length+' verificaciones locales aprobadas; SQL solo lectura.');
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});
