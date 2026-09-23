const {firefox}=require('../../../../bridge/node_modules/playwright-core');
const http=require('node:http'),{createHash}=require('node:crypto');
(async()=>{
const server=http.createServer((q,r)=>r.end('<h1>Local</h1>'));
server.on('upgrade',(req,socket)=>{
const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
socket.write(Buffer.from([0x81,2,111,107]));socket.on('error',()=>{});socket.on('data',()=>socket.end(Buffer.from([0x88,0])));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await firefox.launch();const context=await browser.newContext();const page=await context.newPage();
try{await page.goto(url);console.log('PAGE',await page.evaluate(url=>new Promise((resolve,reject)=>{const ws=new WebSocket(url.replace('http:','ws:'));ws.onmessage=e=>{ws.close();resolve(e.data)};ws.onerror=reject;}),url));
console.log('WORKER',await page.evaluate(url=>new Promise((resolve,reject)=>{const source=`const ws=new WebSocket(${JSON.stringify(url.replace('http:','ws:'))});ws.onmessage=e=>{ws.close();postMessage(e.data);};`;const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));worker.onmessage=e=>{worker.terminate();resolve(e.data)};worker.onerror=reject;}),url));}
finally{await browser.close();server.close();}
})();
