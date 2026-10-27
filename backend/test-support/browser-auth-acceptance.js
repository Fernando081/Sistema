const assert=require('node:assert/strict');
const {expect}=require('@playwright/test');

// Reutiliza dos logins por formulario del arnés de sesiones. No inyecta JWT/cookies.
async function verifyBrowserAuth({api,origin,screens}){
  for(const {page}of screens){
    const cookies=await page.context().cookies(origin+'/api/v1/'),session=cookies.find(row=>row.name==='erp_session');
    assert.ok(session);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Strict');assert.equal(session.path,'/api/v1');
    assert.equal(session.secure,false);assert.ok(!session.domain.startsWith('.'));
    const metadata=await page.evaluate(()=>({cookies:document.cookie,local:localStorage.getItem('access_token'),tab:sessionStorage.getItem('access_token')}));
    assert.ok(!metadata.cookies.includes('erp_session'));assert.equal(metadata.local,null);assert.equal(metadata.tab,null);
    await page.reload();await page.waitForURL('**/perfil');await expect(page.getByRole('heading',{name:'Sesiones activas',exact:true})).toBeVisible();
  }
  const page=screens[0].page,context=page.context(),cookie=(await context.cookies(origin+'/api/v1/')).find(row=>row.name==='erp_session');
  const request=async(path,status,method='GET',headers={})=>{
    const response=await context.request.fetch(api+'/api/v1/'+path,{method,headers,data:method==='POST'?{}:undefined});
    assert.equal(response.status(),status,method+' '+path);return response;
  };
  await request('auth/browser-state',403);
  await request('auth/browser-state',403,'GET',{'X-ERP-Browser':'1',Origin:'https://evil.example.test'});
  const state=await request('auth/browser-state',200,'GET',{'X-ERP-Browser':'1',Origin:origin});
  assert.equal(state.headers()['cache-control'],'private, no-store');assert.deepEqual(Object.keys(await state.json()).sort(),['expiresAt','profile']);
  for(const headers of [
    {Origin:origin}, {'X-ERP-Browser':'1'}, {'X-ERP-Browser':'1',Origin:'null'},
    {'X-ERP-Browser':'1',Origin:'https://evil.example.test'},
    {'X-ERP-Browser':'1',Origin:origin,'Sec-Fetch-Site':'cross-site'},
  ])await request('auth/logout',403,'POST',headers);
  const deniedLogin=await context.request.post(api+'/api/v1/auth/login',{headers:{'X-ERP-Browser':'1',Origin:'https://evil.example.test'},
    data:{username:'csrf-fixture',password:'fixture-password'}});
  assert.equal(deniedLogin.status(),403);
  const duplicate=await fetch(api+'/api/v1/auth/me',{headers:{Cookie:`erp_session=${cookie.value}; erp_session=${cookie.value}`},signal:AbortSignal.timeout(10000)});
  assert.equal(duplicate.status,401);await duplicate.arrayBuffer();
  const invalid=await fetch(api+'/api/v1/auth/me',{headers:{Cookie:'erp_session=invalid.fixture.token'},signal:AbortSignal.timeout(10000)});
  assert.equal(invalid.status,401);assert.ok(invalid.headers.get('set-cookie')?.includes('erp_session=;'));
  await invalid.arrayBuffer();
  await request('auth/me',200);
  const outside=await context.request.fetch(api+'/api/v1/auth/sessions',{method:'OPTIONS',headers:{Origin:'https://evil.example.test',
    'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-ERP-Browser'}});
  assert.notEqual(outside.headers()['access-control-allow-origin'],'https://evil.example.test');
  return {passed:true,httpOnly:true,sameSite:'Strict',legacyStorageCleared:true,restoredAfterReload:true,
    csrfOriginAndHeader:true,crossSiteRejected:true,duplicateCookieRejected:true,untrustedCorsRejected:true,
    note:'HTTP loopback de desarrollo; atributos HTTPS/Host de producción probados por separado en unitarias'};
}
module.exports={verifyBrowserAuth};
