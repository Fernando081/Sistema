const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
const target='verify_audit_00f4549f62e0c430',config=databaseConfig();
(async()=>{const control=new Client(config);let copy;
  try{await control.connect();const [row]=(await control.query("SELECT (pg_stat_file('base/'||oid::text)).creation created_at FROM pg_database WHERE datname=$1",[target])).rows;
    assert.ok(row&&new Date(row.created_at).toISOString()==='2026-10-20T00:10:14.000Z');
    let copyConfig={...config,database:target};if(config.connectionString){const url=new URL(config.connectionString);url.pathname='/'+target;copyConfig={...config,connectionString:url.toString()};}
    copy=new Client(copyConfig);await copy.connect();assert.equal((await copy.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m')")).rows[0].n,0);
    await copy.end();copy=undefined;assert.equal((await control.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[target])).rows[0].n,0);
    await control.query('DROP DATABASE "'+target+'"');assert.equal((await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[target])).rowCount,0);
    fs.writeFileSync('.artifacts/s031-first-copy-cleanup.json',JSON.stringify({removed:true,scope:'empty copy from first audit attempt',createdAt:'2026-10-20T00:10:14.000Z',checkedAt:new Date().toISOString()},null,2)+'\n');console.log('Copia vacía del primer ensayo identificada por nombre/fecha/contenido y eliminada.');
  }finally{if(copy)await copy.end();await control.end();}
})().catch(error=>{console.error(error.name);process.exitCode=1;});
