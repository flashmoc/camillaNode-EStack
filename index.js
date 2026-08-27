//// Global Objects
const express = require('express');
const http = require('http');
const { json } = require('express');
const app = express();
const fs = require('fs');
const WebSocket = require('ws');
const configsFile = "savedConfigs.dat";

//// Global variables
let strAppConfig;

if (fs.existsSync('camillaNodeConfig.json')) {
    strAppConfig = fs.readFileSync('camillaNodeConfig.json');
} else {
    strAppConfig = JSON.stringify({"port":80});
    fs.writeFileSync('camillaNodeConfig.json',strAppConfig);
}
let appConfig = JSON.parse(strAppConfig);

// Hardware keeps using camillaNodeConfig.json. The development launcher can
// override the HTTP port without modifying the Raspberry Pi configuration.
const PORT = Number.parseInt(process.env.CAMILLANODE_PORT || appConfig.port || 80, 10);
let currentConfigName="";

//// Global settings
app.use(express.static(__dirname+'/public/'));

//// Default gets
app.get('/connections',(req,res)=>{
    res.sendFile(__dirname+'/public/html/connections.html');
});

app.get('/basic',(req,res)=>{
    res.sendFile(__dirname+'/public/html/basic.html');
});

app.get('/',(req,res)=>{
    res.sendFile(__dirname+'/public/html/main.html');
});

app.get('/equalizer',(req,res)=>{
    res.sendFile(__dirname+'/public/html/equalizer.html');
});

app.get('/advanced',(req,res)=>{
    res.sendFile(__dirname+'/public/html/advanced.html');
});

app.get('/room',(req,res)=>{
    res.sendFile(__dirname+'/public/html/room.html');
});

app.get('/preferences',(req,res)=>{
    res.sendFile(__dirname+'/public/html/preferences.html');
});

app.get('/spectrum',(req,res)=>{
    res.sendFile(__dirname+'/public/html/spectrum.html');
});

// Small diagnostic endpoint used by the cloud development environment. It is
// intentionally harmless on the Raspberry and exposes no configuration data.
app.get('/api/runtime',(req,res)=>{
    res.json({
        mode: process.env.ESTACK_DEMO === '1' ? 'demo' : 'hardware',
        httpPort: PORT,
        dspPort: Number.parseInt(process.env.CAMILLADSP_PORT || '1234', 10),
        spectrumPort: Number.parseInt(process.env.CAMILLA_SPECTRUM_PORT || '6413', 10)
    });
});

app.post('/saveConfigName',(req,res)=>{
    let queryResponse="";
    req.on('data', function(chunk) {queryResponse+=chunk;}).on('end', function(){
        fs.writeFileSync("currentConfig.json",queryResponse);
    });
});

app.get('/getConfigName',(req,res)=>{
    if (fs.existsSync("currentConfig.json")) {
        let currentConfig = fs.readFileSync("currentConfig.json");
        res.write(JSON.stringify(currentConfig.toString('utf-8')));
    } else {
        let currentConfig = JSON.stringify({"configName":"","configShortcut":""});
        res.write(JSON.stringify(currentConfig));
    }
    res.end();
});

app.post('/saveConfig',(req,res)=>{
    let queryResponse="";
    req.on('data', function(chunk) {
        queryResponse+=chunk;
    }).on('end', function(){
        let config = JSON.parse(queryResponse);
        let fileName = './config/'+config.configName+'.json';
        console.log(fileName);
        let fileBuffer = Buffer.from(JSON.stringify(config),'utf-8');
        fs.writeFileSync(fileName,fileBuffer);
        res.end();
    });
});

app.post('/saveConfigFile',(req,res)=>{
    let queryResponse="";
    req.on('data', function(chunk) {
        queryResponse+=chunk;
    }).on('end', function(){
        let config = JSON.parse(queryResponse);
        let fileName = configsFile;
        let fileBuffer = Buffer.from(JSON.stringify(config),'utf-8');
        fs.writeFileSync(fileName,fileBuffer,function(err){
            console.log("Error saving file ",fileName,"\n",err);
        });
        res.end();
    });
});

app.get('/getConfigFile',function(req,res){
    let filePath=configsFile;
    if (!fs.existsSync(filePath)) {
        res.write(JSON.stringify([]));
        res.end();
        return;
    }

    let config = fs.readFileSync(filePath);
    res.write(config.toString());
    res.end();
});

app.get('/getConfigList',(req,res)=>{
    let files = fs.readdirSync('./config');
    let fileList = Array();
    for (let file of files) {
        if (file.includes('json')) fileList.push(file.replace('.json',''));
    }
    res.write(JSON.stringify(fileList));
    res.end();
});

app.get('/getConfig',function(req,res){
    let filePath='./config/'+req.query.configName+'.json';
    if (!fs.existsSync(filePath)) { res.write('{"status":"error","reason":"Config not found"}'); res.end(); return; }
    let config = fs.readFileSync(filePath);
    res.write(config.toString());
    res.end();
});

app.get('/configExists',function(req,res){
    let filePath='./config/'+req.query.configName+'.json';
    fs.existsSync(filePath)?res.write('true'):res.write('false');
    res.end();
});

app.get('/deleteConfig',function(req,res){
    let filePath='./config/'+req.query.configName+'.json';
    if (!fs.existsSync(filePath)) { res.write('{"status":"error","reason":"Config not found"}'); res.end(); return; }
    try {
        fs.unlink(filePath,(r)=>{
            if (r==null) res.write("Deleted");
            res.end();
        });
    }
    catch(err) {
        console.log("Error deleting configuration file.");
        console.log(err);
    }
});

app.get('/log',function(req,res){
});

app.get('/restartService',function(req,res){
});

// Same-origin WebSocket proxy for E-Stack.
// Browser clients only talk to CamillaNode. CamillaNode then talks to the local
// CamillaDSP processes over loopback. This works on the Raspberry and through
// the HTTPS/WSS URL provided by GitHub Codespaces.
const server = http.createServer(app);
const proxyWss = new WebSocket.Server({ noServer: true });
const proxyHost = process.env.CAMILLADSP_PROXY_HOST || '127.0.0.1';
const proxyTargets = {
    '/ws/dsp': Number.parseInt(process.env.CAMILLADSP_PORT || '1234', 10),
    '/ws/spectrum': Number.parseInt(process.env.CAMILLA_SPECTRUM_PORT || '6413', 10)
};

server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
        pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch (_) {
        socket.destroy();
        return;
    }

    const targetPort = proxyTargets[pathname];
    if (!targetPort) {
        socket.destroy();
        return;
    }

    proxyWss.handleUpgrade(request, socket, head, (client) => {
        const upstream = new WebSocket(`ws://${proxyHost}:${targetPort}`);
        const pendingClientMessages = [];
        let closed = false;

        const closeBoth = () => {
            if (closed) return;
            closed = true;
            try { if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(); } catch (_) {}
            try { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); } catch (_) {}
        };

        // The browser-side WebSocket can become OPEN a few milliseconds before
        // the local upstream is ready. Queue those first API commands instead of
        // dropping GetVersion/GetConfigJson during startup.
        client.on('message', (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
                upstream.send(data, { binary: isBinary });
            } else if (upstream.readyState === WebSocket.CONNECTING) {
                pendingClientMessages.push({ data, isBinary });
            }
        });

        upstream.on('open', () => {
            for (const message of pendingClientMessages.splice(0)) {
                upstream.send(message.data, { binary: message.isBinary });
            }
        });

        upstream.on('message', (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });

        upstream.on('error', (error) => {
            console.error(`WebSocket proxy upstream error on ${pathname}:`, error.message);
            closeBoth();
        });
        upstream.on('close', closeBoth);
        client.on('error', closeBoth);
        client.on('close', closeBoth);
    });
});

server.listen(PORT, () => {
    const mode = process.env.ESTACK_DEMO === '1' ? ' [E-Stack demo]' : '';
    console.log(`CamillaNode is running on port ${PORT}${mode}...`);
});
