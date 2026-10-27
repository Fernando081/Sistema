import { readFile, writeFile } from "node:fs/promises";
const preparation = JSON.parse(await readFile(new URL('web-test-pilot.json', import.meta.url), 'utf8'));
const requests = [
  ['GET','http://127.0.0.1:4600/catalogo',200], ['GET','http://127.0.0.1:4500/',200],
  ['GET','http://127.0.0.1:4300/login',200], ['GET','http://127.0.0.1:3100/api/v1/health',200],
  ['GET','http://127.0.0.1:4600/solicitar',503], ['GET','http://127.0.0.1:4500/solicitar',503],
  ['POST','http://127.0.0.1:3100/api/v1/web-lead-bridge/check',503],
  ['GET','http://127.0.0.1:4600/current-release.json',404], ['GET','http://127.0.0.1:4600/approval.json',404],
  ['GET','http://127.0.0.1:4600/.artifacts/web-test-pilot.json',404],
  ['GET','http://127.0.0.1:4600/.backups/'+preparation.backup.filename,404],
  ['GET','http://127.0.0.1:4600/.runtime/web-test-pilot-current.json',404],
];
const results=await Promise.allSettled(requests.map(async ([method,url,expected])=>{
  const response=await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(5000),
    ...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});
  await response.body?.cancel();return {method,url,expected,status:response.status,passed:response.status===expected};
}));
const probes=results.map((result,i)=>result.status==='fulfilled'?result.value:{method:requests[i][0],url:requests[i][1],expected:requests[i][2],passed:false});
const passed=probes.filter(probe=>probe.passed).length;
await writeFile(new URL('web-test-pilot-live.json',import.meta.url),JSON.stringify({generatedAt:new Date().toISOString(),passed,total:probes.length,probes},null,2));
console.log(`Sondeos locales: ${passed}/${probes.length}.`);
if(passed!==probes.length)process.exitCode=1;
