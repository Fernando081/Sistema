import { expect,test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installErpApiMock,login } from './helpers/erp-api.mock';

for(const theme of ['light','dark']) {
  test(`Avisos de jobs: fallo, leído y navegación al proceso ${theme}`,async({page})=>{
    await page.setViewportSize({width:theme==='dark'?390:1280,height:900});
    await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
    await installErpApiMock(page);await page.emulateMedia({reducedMotion:'reduce'});
    const notices=[{idNotification:7,type:'scheduled_job_failed',title:'Generación de alertas: falló el proceso',
      message:'El último intento finalizado falló. Revise Procesos automáticos.',severity:'critical',route:'/dashboard?procesos=1',
      readAt:null as string|null,createdAt:'2026-10-12T12:00:00Z'},
      {idNotification:8,type:'scheduled_job_overdue',title:'Revisión de frescura: ejecución atrasada',
        message:'No hay éxito confirmado después de la tolerancia. Revise Procesos automáticos.',severity:'warning',route:'/dashboard?procesos=1',
        readAt:null as string|null,createdAt:'2026-10-12T12:00:00Z'}];
    let reads=0;
    await page.route('**/api/v1/notifications**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/7/read')){reads++;notices[0].readAt='2026-10-12T12:01:00Z';return route.fulfill({status:201,json:{message:'Notificación leída'}});}
      return route.fulfill({json:{unread:notices.filter(item=>!item.readAt).length,items:notices}});
    });
    await page.route('**/api/v1/dashboard**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/scheduled-jobs'))return route.fulfill({json:['operational_alerts','dashboard_freshness'].map(name=>({
        name,checkedAt:'2026-10-12T12:00:00Z',expectedAt:'2026-10-12T11:50:00Z',lastSuccessAt:null,overdue:true,
        lastRun:{id:name,startedAt:'2026-10-12T11:50:00Z',finishedAt:'2026-10-12T11:51:00Z',status:'failed'},recentRuns:[]}))});
      if(url.pathname.endsWith('/refresh-status'))return route.fulfill({json:{checkedAt:'2026-10-12T12:00:00Z',expectedAt:'2026-10-12T08:00:00Z',
        lastSuccessAt:null,overdue:true,freshness:'overdue',lastRun:null,recentRuns:[]}});
      return route.fulfill({json:url.pathname.endsWith('/dashboard')?{ventasHoy:0,grafica:[],topProductos:[]}: [{}]});
    });
    await login(page,'/dashboard');await page.getByRole('button',{name:'Abrir notificaciones'}).click();
    const panel=page.getByRole('region',{name:'Notificaciones',exact:true});
    await expect(panel).toContainText('Generación de alertas: falló el proceso');await expect(panel).toContainText('Revisión de frescura: ejecución atrasada');
    const insideViewport=()=>panel.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;});
    await expect.poll(insideViewport).toBe(true);
    expect((await new AxeBuilder({page}).include('.notification-panel').analyze()).violations).toEqual([]);
    await panel.screenshot({path:`../.artifacts/o024-notifications-${theme}.png`});
    await page.setViewportSize({width:320,height:640});await expect.poll(insideViewport).toBe(true);
    await panel.getByRole('button',{name:/Generación de alertas: falló el proceso/}).click();
    await expect(page).toHaveURL(/dashboard\?procesos=1$/);expect(reads).toBe(1);
    await expect(page.getByRole('region',{name:'Generación de alertas',exact:true})).toBeVisible();
    await expect(page.locator('.scheduled-jobs')).toContainText('Leer un aviso no confirma recuperación');
    await expect(page.locator('.scheduled-jobs')).toContainText('El último intento falló');
    await page.getByRole('button',{name:'Abrir notificaciones'}).click();
    await expect(panel.getByRole('button',{name:/Generación de alertas: falló el proceso/})).not.toHaveClass(/unread/);
    await expect(panel.getByRole('button',{name:/Generación de alertas: falló el proceso/})).toHaveClass(/critical/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
  test(`Avisos de jobs: recuperación y enlace directo ${theme}`,async({page})=>{
    await page.setViewportSize({width:390,height:900});await page.addInitScript(value=>localStorage.setItem('theme',value),theme);
    await installErpApiMock(page);
    await page.route('**/api/v1/notifications',route=>route.fulfill({json:{unread:0,items:[{idNotification:9,type:'scheduled_job_recovered',
      title:'Revisión de frescura: proceso recuperado',message:'Una ejecución posterior terminó correctamente y el proceso está al día.',
      severity:'info',route:'/dashboard?procesos=1',readAt:'2026-10-12T12:02:00Z',createdAt:'2026-10-12T12:00:00Z'}]}}));
    await login(page,'/dashboard?procesos=1');await expect(page.locator('.scheduled-jobs')).toHaveAttribute('open','');
    await page.getByRole('button',{name:'Abrir notificaciones'}).click();const panel=page.getByRole('region',{name:'Notificaciones',exact:true});
    const item=panel.getByRole('button',{name:/Revisión de frescura: proceso recuperado/});
    await expect(item).not.toHaveClass(/unread|critical/);await expect(panel.getByRole('button',{name:'Marcar leídas'})).toHaveCount(0);
    await page.getByRole('button',{name:'Abrir notificaciones'}).click();
    await page.getByText('Procesos automáticos',{exact:true}).click();await expect(page.locator('.scheduled-jobs')).not.toHaveAttribute('open','');
    await page.getByRole('button',{name:'Abrir notificaciones'}).click();
    await item.click();await expect(page.locator('.scheduled-jobs')).toHaveAttribute('open','');
  });
}
