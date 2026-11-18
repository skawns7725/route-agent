const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
http.createServer((req,res)=>{
 if(!["/","/route-agent-demo.html"].includes(req.url)){res.writeHead(404).end();return}
 res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
 fs.createReadStream(path.join(__dirname,"route-agent-demo.html")).pipe(res);
}).listen(8080,"127.0.0.1");