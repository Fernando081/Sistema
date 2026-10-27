const {Client}=require('../node_modules/pg'),{databaseConfig}=require('../backend/db-config');
(async()=>{const client=new Client(databaseConfig());try{await client.connect();const result=await client.query(`SELECT datname,oid,
  (pg_stat_file('base/'||oid::text)).creation AS created_at FROM pg_database WHERE datname~'^verify_audit_[a-f0-9]{16}$'`);console.log(JSON.stringify(result.rows));}finally{await client.end();}})().catch(error=>{console.error(error.name);process.exitCode=1;});
