const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('@playwright/test');

(async()=>{
  const probes=[];
  const probe=async(url,status,options={})=>{const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,status,url);probes.push({url,status:response.status});return response;};
  for(let attempt=0;attempt<30;attempt++){
    try{if((await fetch('http://127.0.0.1:3100/api/v1/health',{signal:AbortSignal.timeout(2000)})).status===200)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  await probe('http://127.0.0.1:3100/api/v1/health',200);
  await probe('http://127.0.0.1:4300/login',200);
  await probe('http://127.0.0.1:4500/',200);await probe('http://127.0.0.1:4600/catalogo',200);
  await probe('http://127.0.0.1:4500/solicitar',503);await probe('http://127.0.0.1:4600/solicitar',503);
  const base='http://127.0.0.1:3100/api/v1';
  await probe(base+'/notifications',401);await probe(base+'/dashboard/scheduled-jobs',401);
  const password=process.env.JOB_TEST_PASSWORD;assert.ok(password,'Exige credencial temporal en entorno; no se guarda');
  const username='admin';const login=await probe(base+'/auth/login',201,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  const token=(await login.json()).access_token;
  const headers={Authorization:'Bearer '+token};
  const notifications=await probe(base+'/notifications',200,{headers});assert.equal(notifications.headers.get('cache-control'),'private, no-store');
  const feed=await notifications.json();const status=await probe(base+'/dashboard/scheduled-jobs',200,{headers});const jobs=await status.json();
  assert.deepEqual(jobs.map(j=>j.name),['dashboard_freshness','operational_alerts']);
  const browser=await chromium.launch({headless:true});let ui;
  try {
    const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>localStorage.setItem('theme','dark'));
    await context.route('**/*',route=>{const url=new URL(route.request().url());return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&['3100','4300'].includes(url.port)?route.continue():route.abort();});
    const page=await context.newPage();await page.goto('http://127.0.0.1:4300/login?returnUrl='+encodeURIComponent('/dashboard?procesos=1'));
    await page.getByLabel(/Usuario/).fill(username);await page.getByLabel(/Contraseña/).fill(password);
    await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/dashboard?procesos=1',{timeout:20000});
    await page.locator('.scheduled-jobs[open]').waitFor();await page.getByRole('region',{name:'Generación de alertas',exact:true}).waitFor();
    await page.locator('.scheduled-jobs').screenshot({path:path.join(__dirname,'o024-live-jobs.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'Abrir notificaciones'}).click();await page.getByRole('region',{name:'Notificaciones',exact:true}).waitFor();
    assert.ok(await page.locator('.notification-panel').evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;}));
    ui={realLogin:true,apiMocked:false,injectedJwt:false,theme:'dark',width:390,processesOpen:true,reflow:true,notificationBounds:true};
    await context.close();
  } finally {await browser.close();}
  const report={phase:'O02.4',generatedAt:new Date().toISOString(),node:process.versions.node,source:'current-local-services',
    passed:true,probes,ui,jobNames:jobs.map(job=>job.name),unread:feed.unread,
    limits:['Sin incidentes sintéticos inyectados en la base de trabajo; fallos/recuperaciones comprobados por separado en esquema/copia propios.']};
  fs.writeFileSync(path.join(__dirname,'o024-live.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({probes:probes.length,passed:true,ui,evidence:'.artifacts/o024-live.json'}));
})().catch(error=>{console.error('No se completó verificación local:',error instanceof assert.AssertionError?error.message:error.name);process.exitCode=1;});
