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
    ['http://127.0.0.1:4300/reportes/auditoria',200],
    ['http://127.0.0.1:4300/comercial',200],
    ['http://127.0.0.1:4300/crm/unidades/1/expediente',200],
    ['http://127.0.0.1:3100/api/v1/crm/unidades/1/expediente',401],
    ['http://127.0.0.1:3100/api/v1/comercial/politica-aprobaciones',401],
    ['http://127.0.0.1:3100/api/v1/auditoria/estado',401],
    ['http://127.0.0.1:3100/api/v1/crm/unidades/1/piezas',401],
    ['http://127.0.0.1:3100/api/v1/crm/unidades/1/piezas/origenes',401],
    ['http://127.0.0.1:3100/api/v1/garantias',401],
    ['http://127.0.0.1:4300/garantias',200],
    ['http://127.0.0.1:4300/cotizacion/historial',200],
    ['http://127.0.0.1:4300/cotizacion/1/versiones',200],
    ['http://127.0.0.1:4300/cotizaciones/responder',200],
    ['http://127.0.0.1:3100/api/v1/cotizacion/1/versiones',401],
    ['http://127.0.0.1:4500/',200],
    ['http://127.0.0.1:4600/catalogo',200],
    ['http://127.0.0.1:4500/solicitar',503],
    ['http://127.0.0.1:4600/solicitar',503]]){
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,status,url);await response.arrayBuffer();checks.push({url,status,passed:true});
  }
  for(const [header,status]of[[true,404],[false,403]]){
    const response=await fetch('http://127.0.0.1:3100/api/v1/cotizacion-respuesta/consultar',{method:'POST',headers:{'Content-Type':'application/json',...(header?{'X-Cotizacion-Respuesta':'1'}:{})},body:JSON.stringify({token:require('node:crypto').randomBytes(32).toString('base64url')}),signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,status);await response.arrayBuffer();checks.push({name:'Consulta de respuesta sin enlace emitido / cabecera '+header,status,passed:true});
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
    assert.equal((await client.query("SELECT count(*)::int n FROM schema_migration WHERE filename='102_versiones_cotizacion.sql'")).rows[0].n,1);
    for(const table of ['crm_unidad_lectura','crm_unidad_mantenimiento','crm_unidad_archivo','crm_unidad_archivo_contenido','crm_unidad_pieza','crm_unidad_pieza_garantia','cotizacion_revision','cotizacion_invitacion','cotizacion_respuesta'])assert.equal((await client.query('SELECT count(*)::int n FROM '+table)).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM comercial_regla_aprobacion WHERE version=1 AND monto_maximo IS NULL AND NOT requiere_distinto AND vigencia_maxima_horas=24')).rows[0].n,9);
    assert.equal((await client.query('SELECT count(*)::int n FROM comercial_limite_aprobador')).rows[0].n,0);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='auditoria_jsonb'::regclass AND tgenabled='A' AND ((tgname='trg_audit_append_only' AND tgtype=58 AND tgfoid='fn_audit_append_only()'::regprocedure) OR (tgname='trg_audit_enrich' AND tgtype=7 AND tgfoid='fn_audit_enrich()'::regprocedure))")).rows[0].n,2);
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='trg_access_audit' AND t.tgenabled IN ('A','O') AND t.tgtype=29 AND t.tgfoid='fn_audit_trigger()'::regprocedure AND c.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid='auditoria_jsonb'::regclass) AND c.relname IN ('auth_user','app_permission','app_role_permission','app_user_permission','app_access_profile','app_access_profile_permission','app_user_access_profile')")).rows[0].n,7);
    assert.ok((await client.query("SELECT count(*)::int n FROM auth_user WHERE is_active AND role='admin'")).rows[0].n>0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_mfa')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_mfa_recovery')).rows[0].n,0);
    assert.equal((await client.query('SELECT count(*)::int n FROM auth_password_recovery')).rows[0].n,0);
    assert.ok(process.env.JWT_SECRET && process.env.JWT_SECRET.length>=32,'La emisión necesita clave robusta del servidor');
    assert.equal((await client.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN('cotizacion_revision'::regclass,'cotizacion_respuesta'::regclass) AND tgenabled='A' AND tgtype=58 AND tgfoid='fn_cotizacion_evidencia_inmutable()'::regprocedure")).rows[0].n,2);
    assert.equal((await client.query("SELECT count(*)::int n FROM app_role_permission WHERE permission_code='cotizaciones.versionar' AND role='admin'")).rows[0].n,1);
    await client.query('ROLLBACK');checks.push({name:'102 vigente, dos controles ALWAYS, siete tablas de acceso y administrador persistido activo; consulta solo lectura',passed:true});
  }finally{await client.end();}
  fs.writeFileSync('.artifacts/v01-local-status.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks},null,2)+'\n');console.log(checks.length+' verificaciones locales aprobadas; SQL solo lectura.');
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});



