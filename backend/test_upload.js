const http = require('http');
const fs = require('fs');
const path = require('path');

// Simulate login to get token
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
  res.on('data', (c) => data += c);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      const token = JSON.parse(data).access_token;
      
      // Now upload a dummy file
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      let postData = `--${boundary}\r\n`;
      postData += 'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n';
      postData += 'Content-Type: image/jpeg\r\n\r\n';
      postData += 'dummy data for image\r\n';
      postData += `--${boundary}--\r\n`;

      const uploadOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/upload',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const uploadReq = http.request(uploadOptions, (res2) => {
        let audData = '';
        res2.on('data', (c) => audData += c);
        res2.on('end', () => {
             console.log('Upload Status:', res2.statusCode);
             console.log('Upload Body:', audData);
        });
      });
      uploadReq.write(postData);
      uploadReq.end();
    } else {
        console.log('Login failed:', data);
    }
  });
});
req.write(loginData);
req.end();
