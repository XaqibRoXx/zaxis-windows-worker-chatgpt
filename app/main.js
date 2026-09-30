const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { StateStore } = require('./storage/state');
const { WorkerEngine } = require('./worker-engine');
const { getCollections } = require('./providers/commoncrawl');

let mainWindow = null;
let tray = null;
let store = null;
let engine = null;
let quitting = false;
let cpuLast = null;

function appIcon(){
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#00e7a5"/><path d="M17 17h30v8L29 39h18v8H17v-8l18-14H17z" fill="#06221a"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
function notify(title, body){
  if (!store?.getSettings().notifications) return;
  try { new Notification({ title, body, icon: appIcon() }).show(); } catch {}
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
  for (const j of store.getState().jobs) if (j.status === 'running') store.updateJob(j.id,{status:'interrupted',stage:'Interrupted',message:'Application closed before the job completed.'});
  engine = new WorkerEngine(store);
  engine.on('state', broadcast); engine.on('job', broadcast); engine.on('stats', broadcast);
  engine.on('completed', j=>{ notify('Zaxis Worker',`${j.type.replaceAll('_',' ')} completed for ${j.target}. ${j.resultsFound} result(s).`); broadcast(); });
  engine.on('failed', j=>{ notify('Zaxis Worker',`Job failed: ${j.message}`); broadcast(); });
  createWindow(); createTray();
  if (store.getSettings().autoStartWorker) engine.start();
  setInterval(broadcast, 2500);
});

app.on('window-all-closed', ()=>{ if (process.platform !== 'darwin' && !store?.getSettings().runInBackground) app.quit(); });
app.on('before-quit', ()=>{ quitting=true; });
app.on('activate', ()=>{ if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });

ipcMain.handle('get-state', ()=>snapshot());
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
