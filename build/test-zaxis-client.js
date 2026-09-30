const assert=require('assert');

let calls=[];
global.fetch=async(url,opts={})=>{
  calls.push({url:String(url),opts});
  if(String(url).endsWith('/api/workers/ping')) return {ok:true,status:200,text:async()=>JSON.stringify({ok:true})};
  if(String(url).endsWith('/api/workers/pair')) return {ok:true,status:200,text:async()=>JSON.stringify({workerId:'wrk_123',token:'secret_token',workerName:'Test Worker'})};
  if(String(url).includes('/heartbeat')) return {ok:true,status:200,text:async()=>JSON.stringify({ok:true})};
  return {ok:true,status:200,text:async()=>JSON.stringify({job:null})};
};

const {ZaxisClient,normalizeServerUrl}=require('../app/zaxis-client');

(async()=>{
  assert.equal(normalizeServerUrl('example.com'),'https://example.com');
  const connection={serverUrl:'https://example.com',workerId:'wrk_123'};
  const client=new ZaxisClient({
    getConnection:()=>connection,
    getToken:()=> 'secret_token',
    appVersion:()=> '1.1.0',
    systemInfo:()=>({platform:'win32'})
  });
  const paired=await client.pair({
    serverUrl:'https://example.com',
    workerName:'Test Worker',
    pairingCode:'ZAXIS-TEST-CODE',
    deviceId:'ZW-test',
    capabilities:['capture_lookup']
  });
  assert.equal(paired.workerId,'wrk_123');
  assert.equal(paired.token,'secret_token');
  await client.ping('https://example.com');
  await client.heartbeat({status:'ready'});
  assert(calls.some(x=>x.url.endsWith('/api/workers/pair')));
  assert(calls.some(x=>x.url.endsWith('/api/workers/ping')));
  assert(calls.some(x=>x.url.includes('/heartbeat')&&x.opts.headers.Authorization==='Bearer secret_token'));
  console.log('zaxis client contract test: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
