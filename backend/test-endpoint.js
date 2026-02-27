const http = require('http');

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/v1/reportes/utilidad',
  method: 'GET',
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`BODY: ${data}`);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
