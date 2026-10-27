require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { databaseConfig } = require('../db-config');
const { WebCatalogService } = require('../dist/web-catalog/web-catalog.service');
async function main() {
  assert.equal(process.versions.node.split('.')[0],'24');
  const client = new Client(databaseConfig());
  await client.connect();
  const schema = 'web_catalog_verify_' + randomBytes(8).toString('hex');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`CREATE TABLE auth_user(id_user int PRIMARY KEY);
      CREATE TABLE producto("IdProducto" int PRIMARY KEY,"Codigo" text,"Descripcion" text,"Marca" text,imagenes jsonb,
        "PrecioUnitario" numeric,"Existencia" numeric,"Ubicacion" text,costo numeric);
      CREATE TABLE producto_numero_parte(id_numero int,id_producto int,tipo text,fabricante text,numero text);
      CREATE TABLE producto_aplicacion(id_aplicacion int,id_producto int,fabricante_equipo text,modelo text,motor text,anio_desde int,anio_hasta int,restricciones text);
      INSERT INTO auth_user VALUES(1);
      INSERT INTO producto VALUES(1,'TEST-A','Parte de prueba','Marca de prueba','[]',999,50,'PRIVATE-LOCATION',600),
        (2,'TEST-B','Otra parte','Marca de prueba','[]',999,50,'PRIVATE-LOCATION',600);
      INSERT INTO producto_numero_parte VALUES(1,1,'OEM','Fabricante prueba','OEM-A');
      INSERT INTO producto_aplicacion VALUES(1,1,'Equipo prueba','Modelo prueba','Motor prueba',2000,2005,'Verificar serie');`);
    await client.query(`CREATE TABLE categoria("IdCategoria" int PRIMARY KEY,"Descripcion" text);
      INSERT INTO categoria VALUES(1,'Filtros');
      ALTER TABLE producto ADD COLUMN "IdCategoria" int;
      UPDATE producto SET "IdCategoria"=1;`);
    await client.query(`CREATE TABLE producto_equivalente("IdProducto" int,"IdProductoEquivalente" int);
      INSERT INTO producto_equivalente VALUES(1,2);`);
    await client.query(fs.readFileSync(path.join(__dirname,'../migrations/088_preparacion_catalogo_web.sql'),'utf8'));
    const query = async (sql,params) => (await client.query(sql,params)).rows;
    const source = { query, transaction: async (arg,callback) => {
      const work = typeof arg==='function' ? arg : callback;
      await client.query('SAVEPOINT web_save');
      try { const result=await work({query}); await client.query('RELEASE SAVEPOINT web_save'); return result; }
      catch (error) { await client.query('ROLLBACK TO SAVEPOINT web_save'); throw error; }
    } };
    const service = new WebCatalogService(source);
    const dto = {slug:'parte-prueba-test-a',titulo:'Parte de prueba para ficha web',descripcion:'Descripción técnica de prueba únicamente dentro del esquema temporal.',estado:'borrador',datosRealesConfirmados:false,derechosImagenConfirmados:false,compatibilidadVerificada:false,version:0};
    await client.query(`UPDATE producto SET imagenes='["/uploads/first.png","/uploads/second.png"]' WHERE "IdProducto"=1`);
    await assert.rejects(service.save(1,{...dto,imagenes:['/uploads/other.png']},1),/solo imágenes actuales/);
    await assert.rejects(service.save(1,{...dto,especificaciones:[{nombre:'Altura',valor:'10',unidad:'mm'},{nombre:' altura ',valor:'20',unidad:'mm'}]},1),/No repitas/);
    await assert.rejects(service.save(1,{...dto,equivalencias:[999]},1),/solo equivalencias/);
    const saved = await service.save(1,{...dto,equivalencias:[2],fuenteCompatibilidad:'Catálogo técnico verificado',fuenteReferencias:'Catálogo OEM revisado',imagenes:['/uploads/second.png'],especificaciones:[{nombre:'Altura',valor:'120',unidad:'mm'}]},1);
    assert.equal(saved.snapshot.equivalencias[0].codigo,'TEST-B');
    assert.ok(!('costo' in saved.snapshot.equivalencias[0]));
    assert.equal(saved.snapshot.categoria,'Filtros');
    assert.equal(saved.snapshot.fuenteCompatibilidad,'Catálogo técnico verificado');
    assert.deepEqual(saved.snapshot.imagenes,['/uploads/second.png']);
    assert.deepEqual(saved.snapshot.especificaciones,[{nombre:'Altura',valor:'120',unidad:'mm'}]);
    assert.equal(saved.version,1);
    assert.equal(saved.estado,'borrador');
    assert.equal(saved.snapshot.numerosParte[0].numero,'OEM-A');
    assert.equal(saved.snapshot.aplicaciones[0].motor,'Motor prueba');
    for (const key of ['precio','costo','existencia','ubicacion','PrecioUnitario','Existencia']) assert.ok(!(key in saved.snapshot));
    assert.ok(!JSON.stringify(saved.snapshot).includes('PRIVATE-LOCATION'));
    await client.query(`UPDATE producto SET "Marca"='Marca cambiada' WHERE "IdProducto"=1`);
    const preview = await service.preview(1);
    assert.equal(preview.producto.marca,'Marca cambiada');
    assert.equal(preview.ficha.snapshot.marca,'Marca de prueba');
    await assert.rejects(service.save(1,dto,1),/La ficha cambió/);
    await assert.rejects(service.save(2,dto,1),/dirección ya pertenece/);
    await assert.rejects(service.save(1,{...dto,version:1,estado:'listo',datosRealesConfirmados:true,derechosImagenConfirmados:true,compatibilidadVerificada:true},1),/Para marcar lista/);
    const retired = await service.save(1,{...dto,version:1,estado:'retirado'},1);
    assert.equal(retired.version,2);
    assert.equal(retired.estado,'retirado');
    assert.equal(retired.snapshot.fuenteCompatibilidad,saved.snapshot.fuenteCompatibilidad);
    assert.deepEqual(retired.snapshot.especificaciones,saved.snapshot.especificaciones);
    assert.deepEqual(retired.snapshot.imagenes,saved.snapshot.imagenes);
    await assert.rejects(service.preview(999),/Producto no encontrado/);
    await client.query(`UPDATE producto SET "Codigo"='testa',"Marca"='Marca cambiada' WHERE "IdProducto"=2`);
    const catalog = await service.list({page:1,limit:1,term:'',estado:'todos'});
    assert.equal(catalog.total,2); assert.equal(catalog.data.length,1);
    assert.equal(Number(catalog.data[0].duplicados),2);
    assert.ok(catalog.data[0].pendientes.includes('Revisar posible código duplicado en la marca'));
    assert.equal((await service.list({page:1,limit:25,term:'',estado:'sin_ficha'})).data[0].id,2);
    assert.equal((await service.list({page:1,limit:25,term:'%',estado:'todos'})).total,0);
    assert.equal((await service.list({page:1,limit:25,term:'Filtros',estado:'retirado'})).total,1);
    assert.equal((await service.list({page:1,limit:25,term:'',estado:'todos',revision:'sin_pendientes'})).total,0);
  } finally {
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',[schema])).rows[0].n,0);
    await client.end();
  }
  console.log('Catálogo web: borrador, whitelist, snapshot, versión, slug único, revisión, retiro y rollback aprobados.');
}
main().catch(e=>{ console.error(e.message);process.exitCode=1; });
