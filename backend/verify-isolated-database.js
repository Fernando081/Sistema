// Restaura un respaldo en una base temporal, migra y prueba sin tocar datos operativos.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('./db-config');
const { findPgTool, postgresEnvironment } = require('./backup');
const { CajaService } = require('./dist/caja/caja.service');

async function verify() {
  const argument = process.argv.find((arg) => arg.startsWith('--backup='));
  if (!argument) throw new Error('Indica --backup=RUTA del database.dump creado por npm run db:backup');
  const backupRoot = path.resolve(__dirname, '..', '.backups');
  const dump = path.resolve(argument.slice('--backup='.length));
  if (!dump.startsWith(backupRoot + path.sep) || !fs.existsSync(dump)) throw new Error('El respaldo debe existir dentro de .backups del proyecto');
  const name = `sistema_verify_${Date.now()}_${randomBytes(3).toString('hex')}`;
  if (!/^sistema_verify_\d+_[a-f0-9]{6}$/.test(name)) throw new Error('Nombre de base temporal inválido');
  const base = databaseConfig();
  const admin = new Client(base);
  let created = false;
  let db;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const env = { ...postgresEnvironment(), DB_NAME: name, PGDATABASE: name, TEST_DATABASE_ISOLATED: 'true' };
    if (base.connectionString) {
      const url = new URL(base.connectionString);
      url.pathname = '/' + name;
      env.DATABASE_URL = url.toString();
    } else delete env.DATABASE_URL;
    const options = { env, windowsHide: true, stdio: 'pipe', timeout: 180000, cwd: path.resolve(__dirname, '..') };
    execFileSync(findPgTool('pg_restore'), ['--exit-on-error','--no-owner','--no-acl','--dbname',name,dump],options);
    console.log('Respaldo restaurado en base aislada.');
    process.stdout.write(execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js'),'--check'],options));
    process.stdout.write(execFileSync(process.execPath,[path.join(__dirname,'run-migrations.js')],options));
    db = new DataSource({ type:'postgres', ...(env.DATABASE_URL ? {url:env.DATABASE_URL} : {host:base.host,port:base.port,username:base.user,password:base.password,database:name}), ssl:base.ssl,synchronize:false,entities:[] });
    await db.initialize();
    const [user] = await db.query("SELECT id_user FROM auth_user WHERE is_active AND role='admin' ORDER BY id_user LIMIT 1");
    if (!user) throw new Error('El respaldo no contiene un administrador para las pruebas de caja');
    assert.equal((await db.query('SELECT * FROM saldos')).length,1,'Debe existir una caja general');
    const caja = new CajaService(db);
    const opened = await Promise.allSettled([caja.abrir({contado:1000,notas:'Prueba aislada'},user.id_user),caja.abrir({contado:1000},user.id_user)]);
    assert.equal(opened.filter((result)=>result.status==='fulfilled').length,1,'Dos aperturas simultáneas deben producir un solo turno');
    const turno = opened.find((result)=>result.status==='fulfilled').value;
    await db.transaction(async(manager)=>{
      await manager.query("SELECT set_config('app.current_user_id',$1,true)",[String(user.id_user)]);
      await manager.query("SELECT set_config('app.movement_origin','Verificación aislada',true)");
      await manager.query('UPDATE saldos SET caja_chica=caja_chica+400');
      await manager.query('UPDATE saldos SET caja_chica=caja_chica-75');
      await manager.query('UPDATE saldos SET cuenta_banco=cuenta_banco+200');
    });
    const summary = await caja.resumen();
    assert.equal(Number(summary.turno.esperado_actual),1325);
    assert.equal(Number(summary.totales.entradas),400);
    assert.equal(Number(summary.totales.salidas),75);
    const closing = await Promise.allSettled([caja.cerrar(turno.id_turno,{contado:1320},user.id_user),caja.cerrar(turno.id_turno,{contado:1320},user.id_user)]);
    assert.equal(closing.filter((result)=>result.status==='fulfilled').length,1,'Un turno no puede cerrarse dos veces');
    const closedTurn = closing.find((result)=>result.status==='fulfilled').value;
    assert.equal(Number(closedTurn.diferencia),-5,`Respuesta de cierre inesperada: ${JSON.stringify(closedTurn)}`);
    const movements=await caja.movimientos(turno.id_turno,1);
    assert.equal(movements.total,3);
    await assert.rejects(db.query('UPDATE caja_movimiento SET efectivo=0'), /inmutable/);
    console.log('Caja: concurrencia de apertura/cierre, movimientos, conteo y bitácora inmutable verificados.');
    const operations = path.join(__dirname,'scratch','verify-operaciones-2026-09-16.js');
    if(fs.existsSync(operations)) process.stdout.write(execFileSync(process.execPath,[operations],options));
  } finally {
    if (db?.isInitialized) await db.destroy();
    // Solo elimina la base temporal creada por esta misma ejecución y con prefijo validado.
    if (created && /^sistema_verify_\d+_[a-f0-9]{6}$/.test(name)) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log('Base de verificación eliminada. La base de operación no fue modificada.');
    }
    await admin.end();
  }
}

verify().catch((error)=>{
  console.error(`Verificación fallida: ${error.message}`);
  if(error.stderr) console.error(String(error.stderr).slice(-3000));
  process.exitCode=1;
});
