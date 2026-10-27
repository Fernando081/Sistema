const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
async function main(){
 assert.equal(process.versions.node.split('.')[0],'24');const checks=[];
 for(const[url,status,headers]of[
  ['http://127.0.0.1:3100/api/v1/health',200],['http://127.0.0.1:4300/cliente',200],['http://127.0.0.1:4300/portal',200],
  ['http://127.0.0.1:4500/',200],['http://127.0.0.1:4600/catalogo',200],['http://127.0.0.1:4500/solicitar',503],
  ['http://127.0.0.1:3100/api/v1/clientes/1/portal-publicaciones',401],['http://127.0.0.1:3100/api/v1/clientes/1/portal-publicaciones/candidatos/xml',401],
  ['http://127.0.0.1:3100/api/v1/portal/archivos',403],
  ['http://127.0.0.1:3100/api/v1/portal/archivos',401,{'X-Portal-Browser':'1',Origin:'http://127.0.0.1:4300'}],
  ['http://127.0.0.1:3100/api/v1/portal/archivos/1/descarga',401,{'X-Portal-Browser':'1',Origin:'http://127.0.0.1:4300'}],
  ['http://127.0.0.1:3100/api/v1/portal/archivos',403,{'X-Portal-Browser':'1',Origin:'https://outside.example.test'}],
 ]){const r=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});assert.equal(r.status,status,url);await r.arrayBuffer();checks.push({url,status,passed:true});}
 const db=new Client(databaseConfig());await db.connect();try{
  await db.query('BEGIN READ ONLY');
  const migration=(await db.query("SELECT count(*)::int n FROM schema_migration WHERE filename='105_portal_publicaciones.sql'")).rows[0].n;assert.equal(migration,1);checks.push({name:'105 aplicada',passed:true});
  for(const table of['portal_publicacion','portal_publicacion_archivo','portal_publicacion_retiro','portal_acceso','portal_credencial','portal_invitacion','portal_sesion','portal_evento']){assert.equal((await db.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);checks.push({name:table+' vacía sin sembrado',passed:true});}
  assert.equal((await db.query("SELECT count(*)::int n FROM app_role_permission WHERE role='admin' AND permission_code='portal.publicar'")).rows[0].n,1);checks.push({name:'Permiso ADMIN inicial',passed:true});
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN('portal_publicacion'::regclass,'portal_publicacion_archivo'::regclass,'portal_publicacion_retiro'::regclass) AND tgfoid='fn_portal_publicacion_inmutable()'::regprocedure AND tgenabled='A' AND tgtype=58")).rows[0].n,3);checks.push({name:'Tres guardas ALWAYS',passed:true});
  const guard=(await db.query("SELECT pg_get_functiondef('fn_portal_proteger_secretos()'::regprocedure) body")).rows[0].body;assert.ok(guard.includes('portal_publicacion_archivo'));assert.ok(guard.includes('portal_credencial'));checks.push({name:'Guard de auditoría de bytes y secretos',passed:true});
  await db.query('ROLLBACK');
 }finally{await db.end();}
 fs.writeFileSync('.artifacts/v032-local-status.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,sqlReadOnly:true,checks},null,2)+'\n');console.log(checks.length+' comprobaciones locales; SQL sólo lectura.');
}
main().catch(e=>{console.error(e instanceof assert.AssertionError?e.message:e.name);process.exitCode=1;});
