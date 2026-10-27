const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
async function main(){
  assert.equal(process.versions.node.split('.')[0],'24');const checks=[];
  for(const [url,status]of [
    ['http://127.0.0.1:3100/api/v1/health',200],
    ['http://127.0.0.1:3100/api/v1/auth/browser-state',401],
    ['http://127.0.0.1:3100/api/v1/auth/sessions',401],
    ['http://127.0.0.1:3100/api/v1/auth/mfa/status',401],
    ['http://127.0.0.1:3100/api/v1/auth/password-recovery/status',401],
    ['http://127.0.0.1:4300/login/recuperar',200],
    ['http://127.0.0.1:4300/perfil',200],
    ['http://127.0.0.1:4500/',200],
    ['http://127.0.0.1:4600/catalogo',200],
    ['http://127.0.0.1:4500/solicitar',503],
    ['http://127.0.0.1:4600/solicitar',503]]){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);await response.arrayBuffer();checks.push({url,status,passed:true});
  }
  for(const origin of ['http://127.0.0.1:4300','https://outside.example.test']){
    const response=await fetch('http://127.0.0.1:3100/api/v1/auth/login',{method:'OPTIONS',headers:{Origin:origin,
      'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-ERP-Browser,Content-Type'},signal:AbortSignal.timeout(10000)});
    if(origin.startsWith('http://127')){
      assert.equal(response.headers.get('access-control-allow-origin'),origin);
      assert.equal(response.headers.get('access-control-allow-credentials'),'true');
    }else assert.equal(response.headers.get('access-control-allow-origin'),null);
    await response.arrayBuffer();checks.push({name:'Preflight CORS '+origin,passed:true});
  }
  const client=new Client(databaseConfig());await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    assert.equal((await client.query("SELECT count(*)::int n FROM schema_migration WHERE filename='097_recuperacion_cuenta_local.sql'")).rows[0].n,1);
    assert.ok((await client.query("SELECT count(*)::int n FROM auth_user WHERE is_active AND role='admin'")).rows[0].n>0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_mfa')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_mfa_recovery')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_password_recovery')).rows[0].n,0);
    await client.query('ROLLBACK');checks.push({name:'097 vigente y administrador persistido activo; consulta solo lectura',passed:true});
  }finally{await client.end();}
  fs.writeFileSync('.artifacts/s024-local-status.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks},null,2)+'\n');console.log(checks.length+' verificaciones locales aprobadas; SQL solo lectura.');
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});
