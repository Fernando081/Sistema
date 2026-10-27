const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
const client=new Client({...databaseConfig(),connectionTimeoutMillis:5000,statement_timeout:5000});
(async()=>{try{await client.connect();const result=await client.query(`SELECT application_name,state,wait_event_type,wait_event,
  CASE WHEN datname LIKE 'verify_mfa_%' THEN 'copia MFA' ELSE 'otra conexion' END scope FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state<>'idle'`);
  console.log(JSON.stringify(result.rows));}catch(error){console.error('Sondeo PostgreSQL:',error.code||error.name);process.exitCode=1;}finally{await client.end();}})();
