const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, dialog, shell, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { StateStore } = require('./storage/state');
const { WorkerEngine } = require('./worker-engine');
const { getCollections } = require('./providers/commoncrawl');
const { ZaxisClient, normalizeServerUrl } = require('./zaxis-client');

let mainWindow = null;
let tray = null;
let store = null;
let engine = null;
let quitting = false;
let cpuLast = null;
let zaxisClient = null;
let heartbeatTimer = null;
let remotePollTimer = null;
let remoteSyncBusy = false;

const workerCapabilities = ['capture_lookup','url_history','live_verify','common_crawl_index','background_jobs','result_upload'];

function appIcon(){
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#00e7a5"/><path d="M17 17h30v8L29 39h18v8H17v-8l18-14H17z" fill="#06221a"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function notify(title, body){
  if (!store?.getSettings().notifications) return;
  try { new Notification({ title, body, icon: appIcon() }).show(); } catch {}
}

function encryptToken(token){
  if (!token) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable on this device.');
  return safeStorage.encryptString(token).toString('base64');
}

function decryptToken(){
  const cipher=store?.getConnection()?.tokenCipher;
  if (!cipher) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(cipher,'base64'));
  } catch { return ''; }
}

function publicConnection(){
  const c=store?.getConnection()||{};
  return {
    serverUrl:c.serverUrl||'',
    workerName:c.workerName||'',
    deviceId:c.deviceId||'',
    workerId:c.workerId||'',
    status:c.status||'disconnected',
    lastHeartbeat:c.lastHeartbeat||null,
    lastError:c.lastError||'',
    pairedAt:c.pairedAt||null,
    hasToken:!!c.tokenCipher
  };
}

function systemIdentity(){
  return {
    platform:process.platform,
    arch:os.arch(),
    release:os.release(),
    hostname:os.hostname()
  };
}

function remoteJobPayload(){
  const st=engine?.status()||{};
  const current=store?.getState().jobs.find(j=>j.id===st.currentJobId);
  return {
    status:!st.running?'offline':st.paused?'paused':st.busy?'busy':'ready',
    currentJob:current?{localJobId:current.id,remoteJobId:current.meta?.remoteJobId||null,type:current.type,target:current.target,progress:current.progress,stage:current.stage}:null,
    appVersion:app.getVersion(),
    platform:systemIdentity(),
    capabilities:workerCapabilities
  };
}

async function sendHeartbeat(){
  const conn=store?.getConnection();
  if (!conn?.workerId || !conn?.tokenCipher || !zaxisClient) return;
  try {
    await zaxisClient.heartbeat(remoteJobPayload());
    store.updateConnection({status:'connected',lastHeartbeat:new Date().toISOString(),lastError:''});
  } catch(err) {
    store.updateConnection({status:'error',lastError:err.message});
  }
  broadcast();
}

async function syncRemoteJob(){
  if (remoteSyncBusy || !engine?.running || engine.paused || engine.current) return;
  const conn=store?.getConnection();
  if (!conn?.workerId || !conn?.tokenCipher || !zaxisClient) return;
  remoteSyncBusy=true;
  try {
    const remote=await zaxisClient.nextJob();
    if (!remote?.id) return;
    if (store.getState().jobs.some(j=>j.meta?.remoteJobId===remote.id && !['failed','cancelled'].includes(j.status))) return;
    const allowed=['capture_lookup','url_history','live_verify'];
    if (!allowed.includes(remote.type)) {
      await zaxisClient.failJob(remote.id,{message:'Unsupported job type on this worker.',code:'UNSUPPORTED_JOB_TYPE'});
      return;
    }
    await zaxisClient.acceptJob(remote.id);
    const job=store.createJob({
      type:remote.type,
      target:remote.target,
      dataset:remote.dataset||'latest',
      provider:remote.provider||'Zaxis Remote'
    });
    store.updateJob(job.id,{meta:{...(job.meta||{}),remoteJobId:remote.id,remote:true,requestedBy:remote.requestedBy||null}});
    store.addLog('info','Zaxis',`Accepted remote job ${remote.id}`,job.id);
    broadcast();
    engine.pump();
  } catch(err) {
    store.updateConnection({lastError:err.message});
  } finally {
    remoteSyncBusy=false;
  }
}

function startRemoteLoops(){
  clearInterval(heartbeatTimer);
  clearInterval(remotePollTimer);
  heartbeatTimer=setInterval(()=>sendHeartbeat(),15000);
  remotePollTimer=setInterval(()=>syncRemoteJob(),8000);
}

function createWindow(){
  const settings = store.getSettings();
  mainWindow = new BrowserWindow({
    width: 1420, height: 900, minWidth: 1100, minHeight: 700,
    show: !(settings.launchMinimized && app.getLoginItemSettings().wasOpenedAtLogin),
    backgroundColor: '#0b1020',
    icon: appIcon(),
    title: 'Zaxis Worker',
    webPreferences: { preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true }
  });
  mainWindow.loadFile(path.join(__dirname,'ui','index.html'));
  mainWindow.removeMenu();
  mainWindow.on('close', (e) => {
    if (!quitting && store.getSettings().runInBackground) {
      e.preventDefault(); mainWindow.hide(); notify('Zaxis Worker','Zaxis Worker is still running in the background.');
    }
  });
  mainWindow.on('show', () => mainWindow.webContents.send('state-updated', snapshot()));
}

function createTray(){
  if (tray) tray.destroy();
  if (!store.getSettings().showTrayIcon) return;
  const image = appIcon();
  tray = new Tray(image.resize({width:16,height:16}));
  tray.setToolTip('Zaxis Worker');
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  refreshTrayMenu();
}

function refreshTrayMenu(){
  if (!tray) return;
  const st = engine.status();
  const label = !st.running ? 'Stopped' : st.paused ? 'Paused' : st.busy ? 'Busy' : 'Ready';
  const menu = Menu.buildFromTemplate([
    { label:'Open Zaxis Worker', click:()=>{ mainWindow.show(); mainWindow.focus(); } },
    { label:`Worker Status: ${label}`, enabled:false },
    { type:'separator' },
    { label:'Start Worker', enabled:!st.running, click:()=>engine.start() },
    { label:'Pause Worker', enabled:st.running && !st.paused, click:()=>engine.pause() },
    { label:'Resume Worker', enabled:st.running && st.paused, click:()=>engine.resume() },
    { label:'Stop Worker', enabled:st.running, click:()=>engine.stop() },
    { type:'separator' },
    { label:'Settings', click:()=>{ mainWindow.show(); mainWindow.webContents.send('navigate','settings'); } },
    { label:'Exit Zaxis Worker', click:()=>{ quitting=true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function cpuUsage(){
  const cpus = os.cpus();
  const totals = cpus.reduce((a,c)=>{
    const t = Object.values(c.times).reduce((x,y)=>x+y,0);
    a.idle += c.times.idle; a.total += t; return a;
  },{idle:0,total:0});
  if (!cpuLast) { cpuLast = totals; return 0; }
  const idle = totals.idle - cpuLast.idle; const total = totals.total - cpuLast.total; cpuLast = totals;
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1-idle/total)*100))) : 0;
}

function snapshot(){
  const state = store.getState();
  const mem = process.memoryUsage();
  return {
    settings: state.settings, jobs: state.jobs, logs: state.logs.slice(0,500), stats: state.stats,
    connection: publicConnection(),
    engine: engine.status(),
    system: {
      platform: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
      arch: os.arch(),
      cpuUsage: cpuUsage(),
      appRamBytes: mem.rss,
      totalRamBytes: os.totalmem(),
      freeRamBytes: os.freemem(),
      uptimeSec: Math.floor(process.uptime()),
      version: app.getVersion(),
      dataPath: app.getPath('userData')
    }
  };
}

function broadcast(){ if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state-updated', snapshot()); refreshTrayMenu(); }

app.whenReady().then(async()=>{
  app.setAppUserModelId('com.zaxismedia.worker');
  store = new StateStore(app.getPath('userData'));
  if (!store.getConnection().deviceId) store.updateConnection({deviceId:`ZW-${crypto.randomUUID()}`,workerName:store.getConnection().workerName||os.hostname()});
  zaxisClient = new ZaxisClient({
    getConnection:()=>store.getConnection(),
    getToken:()=>decryptToken(),
    appVersion:()=>app.getVersion(),
    systemInfo:()=>systemIdentity()
  });
  for (const j of store.getState().jobs) if (j.status === 'running') store.updateJob(j.id,{status:'interrupted',stage:'Interrupted',message:'Application closed before the job completed.'});
  engine = new WorkerEngine(store);
  engine.on('state', broadcast);
  engine.on('job', j=>{
    broadcast();
    const remoteId=j?.meta?.remoteJobId;
    if(remoteId&&zaxisClient&&['running','paused','interrupted','cancelled'].includes(j.status)){
      zaxisClient.progress(remoteId,{status:j.status,stage:j.stage,progress:j.progress,processed:j.processed,total:j.total,resultsFound:j.resultsFound,message:j.message}).catch(()=>{});
    }
  });
  engine.on('stats', broadcast);
  engine.on('completed', async j=>{
    notify('Zaxis Worker',`${j.type.replaceAll('_',' ')} completed for ${j.target}. ${j.resultsFound} result(s).`);
    const remoteId=j.meta?.remoteJobId;
    if(remoteId&&zaxisClient){
      try {
        const result=store.getResult(j.id);
        await zaxisClient.uploadResults(remoteId,{result,summary:{resultsFound:j.resultsFound,processed:j.processed,dataset:j.meta?.dataset||j.dataset}});
        await zaxisClient.completeJob(remoteId,{resultsFound:j.resultsFound,processed:j.processed});
      } catch(err) { store.addLog('error','Zaxis',`Remote result upload failed: ${err.message}`,j.id); }
    }
    broadcast();
  });
  engine.on('failed', j=>{
    notify('Zaxis Worker',`Job failed: ${j.message}`);
    const remoteId=j.meta?.remoteJobId;
    if(remoteId&&zaxisClient) zaxisClient.failJob(remoteId,{message:j.message||'Worker job failed'}).catch(()=>{});
    broadcast();
  });
  createWindow(); createTray();
  if (store.getSettings().autoStartWorker) engine.start();
  setInterval(broadcast, 2500);
  startRemoteLoops();
  if (store.getConnection().workerId && store.getConnection().tokenCipher) sendHeartbeat();
});

app.on('window-all-closed', ()=>{ if (process.platform !== 'darwin' && !store?.getSettings().runInBackground) app.quit(); });
app.on('before-quit', ()=>{ quitting=true; });
app.on('activate', ()=>{ if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

ipcMain.handle('get-state', ()=>snapshot());

ipcMain.handle('zaxis-test', async(_e, serverUrl)=>{
  const server=normalizeServerUrl(serverUrl||store.getConnection().serverUrl);
  if (store.getConnection().workerId && decryptToken() && server===store.getConnection().serverUrl) {
    await zaxisClient.heartbeat(remoteJobPayload());
    store.updateConnection({status:'connected',lastHeartbeat:new Date().toISOString(),lastError:''});
    broadcast();
    return {ok:true,message:'Connected to Zaxis successfully.'};
  }
  await zaxisClient.ping(server);
  return {ok:true,message:'Zaxis server API is reachable.'};
});

ipcMain.handle('zaxis-pair', async(_e, input)=>{
  const current=store.getConnection();
  store.updateConnection({status:'connecting',lastError:''});
  broadcast();
  try {
    const paired=await zaxisClient.pair({
      serverUrl:input.serverUrl,
      workerName:input.workerName||current.workerName||os.hostname(),
      pairingCode:input.pairingCode,
      deviceId:current.deviceId,
      capabilities:workerCapabilities
    });
    store.updateConnection({
      serverUrl:paired.serverUrl,
      workerName:paired.workerName||input.workerName||current.workerName||os.hostname(),
      workerId:paired.workerId,
      tokenCipher:encryptToken(paired.token),
      status:'connected',
      pairedAt:new Date().toISOString(),
      lastHeartbeat:null,
      lastError:''
    });
    await sendHeartbeat();
    startRemoteLoops();
    notify('Zaxis Worker','Connected to Zaxis successfully.');
    broadcast();
    return publicConnection();
  } catch(err) {
    store.updateConnection({status:'error',lastError:err.message});
    broadcast();
    throw err;
  }
});

ipcMain.handle('zaxis-disconnect', async()=>{
  store.clearConnection();
  if (!store.getConnection().deviceId) store.updateConnection({deviceId:`ZW-${crypto.randomUUID()}`,workerName:os.hostname()});
  broadcast();
  return publicConnection();
});
ipcMain.handle('worker-action', (_e, action)=>{
  if (action==='start') engine.start();
  if (action==='stop') engine.stop();
  if (action==='pause') engine.pause();
  if (action==='resume') engine.resume();
  broadcast(); return snapshot();
});
ipcMain.handle('create-job', (_e, input)=>{
  const allowed = ['capture_lookup','url_history','live_verify'];
  if (!allowed.includes(input.type)) throw new Error('Unsupported job type.');
  const job = store.createJob(input); store.addLog('info','Job',`Queued ${job.type} for ${job.target}`,job.id); if(!engine.running) engine.start(); else if(engine.paused) engine.resume(); broadcast(); engine.pump(); return job;
});
ipcMain.handle('job-action', (_e, {id,action})=>{
  const j = store.getState().jobs.find(x=>x.id===id); if(!j) throw new Error('Job not found');
  if(action==='cancel') engine.cancel(id);
  if(action==='retry' && ['failed','cancelled','interrupted'].includes(j.status)) store.updateJob(id,{status:'queued',stage:'Queued',progress:0,finishedAt:null,message:''});
  if(action==='delete') store.deleteJob(id);
  broadcast(); engine.pump(); return true;
});
ipcMain.handle('get-result', (_e,id)=>store.getResult(id));
ipcMain.handle('save-settings', (_e, patch)=>{
  const settings = store.updateSettings(patch);
  if ('startWithWindows' in patch || 'launchMinimized' in patch) {
    try { app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, openAsHidden: !!settings.launchMinimized }); } catch {}
  }
  if ('showTrayIcon' in patch) createTray();
  broadcast(); return settings;
});
ipcMain.handle('list-datasets', async()=>{
  try { return await getCollections(n=>store.bumpStat('networkDownBytes',n)); }
  catch(err){ store.addLog('error','Common Crawl',err.message); throw err; }
});
ipcMain.handle('clear-logs', ()=>{ store.clearLogs(); broadcast(); return true; });
ipcMain.handle('open-data-folder', ()=>shell.openPath(app.getPath('userData')));
ipcMain.handle('export-result', async(_e,id)=>{
  const data=store.getResult(id); if(!data) throw new Error('No results found.');
  const {filePath,canceled}=await dialog.showSaveDialog({title:'Export Results',defaultPath:`zaxis-worker-${id}.json`,filters:[{name:'JSON',extensions:['json']},{name:'CSV',extensions:['csv']}]});
  if(canceled||!filePath) return null;
  if(filePath.toLowerCase().endsWith('.csv')){
    const items=data.items||[]; const keys=[...new Set(items.flatMap(x=>Object.keys(x)))];
    const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
    fs.writeFileSync(filePath,[keys.map(esc).join(','),...items.map(x=>keys.map(k=>esc(x[k])).join(','))].join('\n'));
  } else fs.writeFileSync(filePath,JSON.stringify(data,null,2));
  return filePath;
});
ipcMain.handle('export-logs', async()=>{
  const {filePath,canceled}=await dialog.showSaveDialog({title:'Export Logs',defaultPath:'zaxis-worker-logs.json',filters:[{name:'JSON',extensions:['json']}]});
  if(canceled||!filePath) return null; fs.writeFileSync(filePath,JSON.stringify(store.getState().logs,null,2)); return filePath;
});
