const { Client } = require('pg');
const { databaseConfig } = require('../backend/db-config');
const { writeFile, readFile, realpath, lstat } = require('node:fs/promises');
const { join, sep } = require('node:path');
(async () => {
  const client = new Client(databaseConfig());
  let report = { status: 'not-completed' };
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const { rows } = await client.query(`SELECT p."IdProducto" id,p."Codigo" code,p."Descripcion" title,p."Marca" brand,c."Descripcion" category,p.imagenes
      FROM public.producto p LEFT JOIN public.categoria c ON c."IdCategoria"=p."IdCategoria"
      WHERE nullif(trim(p."Codigo"),'') IS NOT NULL AND nullif(trim(p."Marca"),'') IS NOT NULL
      ORDER BY CASE WHEN jsonb_typeof(p.imagenes)='array' THEN jsonb_array_length(p.imagenes) ELSE 0 END DESC,p."IdProducto" LIMIT 80`);
    const base = await realpath(join(__dirname,'../backend/uploads'));
    for(const product of rows) {
      const images=[];
      for (const image of Array.isArray(product.imagenes)?product.imagenes:[]) {
        if(typeof image!=='string')continue;
        const name=image.replace(/^\/uploads\//,'');
        if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(name))continue;
        try {
          const path=join(base,name), entry=await lstat(path);
          if(!entry.isFile()||entry.isSymbolicLink()||entry.size>8000000||!(await realpath(path)).startsWith(base+sep))continue;
          const bytes=await readFile(path);
          images.push({name,bytes:bytes.length,format:bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':'other',
            ...(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}:{})});
        }catch{}
      }
      product.images=images; delete product.imagenes;
    }
    report={status:'inspected-read-only',transactionReadOnly:(await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
      profiles:(await client.query('SELECT count(*)::int n FROM public.web_producto_ficha')).rows[0].n,
      candidates:rows};
    await client.query('ROLLBACK');
  }catch {process.exitCode=1;}
  finally {await client.end();}
  await writeFile(join(__dirname,'web-pilot-source-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,readOnly:report.transactionReadOnly,profiles:report.profiles,
    inspected:report.candidates?.length,withPng:report.candidates?.filter(p=>p.images.some(i=>i.format==='png')).length,
    smallPng:report.candidates?.filter(p=>p.images.some(i=>i.format==='png'&&i.bytes<=250000)).length,
    selected:report.candidates?.slice(0,10)},null,2));
})();
