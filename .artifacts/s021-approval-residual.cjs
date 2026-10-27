const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
async function main(){
 const client=new Client(databaseConfig());await client.connect();
 try{
  const rows=(await client.query("SELECT nspname FROM pg_namespace WHERE nspname~'^web_approval_verify_[a-f0-9]{16}$'")).rows;
  assert.equal(rows.length,1,'La limpieza requiere un único esquema residual identificable');
  const schema=rows[0].nspname;assert.match(schema,/^web_approval_verify_[a-f0-9]{16}$/);
  const baseline=fs.readFileSync('.backups/2026-10-19T18-33-17-986Z/database-index.txt','utf8');
  assert.equal(baseline.includes(schema),false,'El esquema ya existía en el respaldo previo al intento');
  const tables=(await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows.map(row=>row.tablename);
  assert.ok(tables.includes('auth_user')&&tables.includes('auth_session')&&tables.includes('web_producto_ficha'));
  const fixture=(await client.query(`SELECT id_user,username FROM "${schema}".auth_user ORDER BY id_user`)).rows;
  assert.deepEqual(fixture,[{id_user:1,username:'fixture-admin'},{id_user:2,username:'fixture-user'}]);
  assert.equal((await client.query(`SELECT count(*)::int n FROM "${schema}".producto`)).rows[0].n,2);
  // Esquema nuevo del arnés detenido: ausente en respaldo previo y exactamente sus fixtures conocidos.
  await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  assert.equal((await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema])).rowCount,0);
  fs.writeFileSync('.artifacts/s021-approval-cleanup.json',JSON.stringify({passed:true,schema,absentFromPreAttemptBackup:true,knownFixturesOnly:true,removed:true,checkedAt:new Date().toISOString()},null,2)+'\n');
  console.log('Esquema residual propio del arnés retirado tras contraste con respaldo y fixtures conocidos.');
 }finally{await client.end();}
}
main().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});
