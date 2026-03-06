const http = require('http');

const loginData = JSON.stringify({ email: 'admin', password: 'F8pz6u4oi*' });

const loginOptions = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

const req = http.request(loginOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Login Status:', res.statusCode);
    console.log('Login Response:', data);
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      const token = JSON.parse(data).access_token;
      
      const getOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/auditoria',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      };
      
      const getReq = http.request(getOptions, (res2) => {
        let audData = '';
        res2.on('data', (c) => audData += c);
        res2.on('end', () => {
             console.log('Auditoria Status:', res2.statusCode);
             console.log('Auditoria payload length:', audData.length);
             if (audData.length < 500) console.log('Auditoria body:', audData);
        });
      });
      getReq.end();
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(loginData);
req.end();
