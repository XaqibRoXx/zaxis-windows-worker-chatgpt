let state=null; let page='dashboard'; let selectedJob=null; let selectedResult=null; let jobBackPage='jobs'; let datasets=[]; const commonCrawlDraft={target:'',type:'capture_lookup',dataset:'latest'};
const $=s=>document.querySelector(s); const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function bytes(n){if(!n)return'0 B';const u=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return `${v.toFixed(v>=100?0:v>=10?1:2)} ${u[i]}`}
function duration(sec){sec=Math.max(0,sec||0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=Math.floor(sec%60);return h?`${h}h ${m}m`:m?`${m}m ${s}s`:`${s}s`}
function titleType(t){return ({capture_lookup:'Domain Capture Lookup',url_history:'URL History',live_verify:'Live URL Verification'})[t]||t}
function statusLabel(){if(!state?.engine.running)return'Stopped';if(state.engine.paused)return'Paused';if(state.engine.busy)return'Busy';return'Ready'}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function isEditing(){const el=document.activeElement;return !!el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable)}
function captureCommonCrawlDraft(){if(page!=='commoncrawl')return;const target=$('#target'),type=$('#jobType'),dataset=$('#dataset');if(target)commonCrawlDraft.target=target.value;if(type)commonCrawlDraft.type=type.value;if(dataset)commonCrawlDraft.dataset=dataset.value}
function nav(p){captureCommonCrawlDraft();if(p!=='job'){selectedJob=null;selectedResult=null}page=p;document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===p));render();}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>nav(b.dataset.page));
window.zaxis.onNavigate(p=>nav(p));
window.zaxis.onState(async s=>{state=s;renderTop();if(page==='job'&&selectedJob){const j=state.jobs.find(x=>x.id===selectedJob);if(j?.resultFile&&!selectedResult){try{selectedResult=await window.zaxis.getResult(selectedJob)}catch{}}}if(!isEditing())render();});

function renderTop(){if(!state)return;const st=statusLabel();$('#sideStatus').textContent=`Worker ${st}`;$('#connDot').classList.toggle('on',state.engine.running&&!state.engine.paused);$('#version').textContent=`v${state.system.version}`;$('#enginePill').textContent=st;$('#enginePill').className='pill '+(st==='Ready'?'ready':st==='Busy'?'busy':st==='Paused'?'paused':'');$('#startBtn').textContent=state.engine.running?'Stop Worker':'Start Worker';$('#pauseBtn').textContent=state.engine.paused?'Resume':'Pause';$('#pauseBtn').style.display=state.engine.running?'inline-block':'none';}
$('#startBtn').onclick=async()=>{await window.zaxis.workerAction(state.engine.running?'stop':'start')};$('#pauseBtn').onclick=async()=>{await window.zaxis.workerAction(state.engine.paused?'resume':'pause')};

function setHeader(t,s){$('#pageTitle').textContent=t;$('#pageSub').textContent=s}
function card(label,value,sub=''){return `<div class="card stat"><label>${label}</label><div class="value">${value}</div><small>${sub}</small></div>`}
function jobStatus(j){return `<span class="status-chip ${esc(j.status)}">${esc(j.status)}</span>`}
function recentJobs(limit=5){const js=state.jobs.slice(0,limit);if(!js.length)return'<div class="empty">No jobs yet. Create your first Common Crawl job.</div>';return js.map(j=>`<div class="job-row"><div><div class="job-title">${esc(titleType(j.type))}</div><div class="muted">${esc(j.target)}</div></div><div><div class="progress"><span style="width:${j.progress||0}%"></span></div><div class="muted" style="margin-top:5px">${esc(j.stage||'')} · ${j.indeterminate?'Working…':`${j.progress||0}%`}</div></div><div>${jobStatus(j)}</div><div class="muted">${j.resultsFound||0} results</div><div><button class="btn small" onclick="openJob('${j.id}')">View</button></div></div>`).join('')}

function dashboard(){setHeader('Dashboard','Local worker health, jobs and system activity.');const current=state.jobs.find(j=>j.id===state.engine.currentJobId);return `<div class="grid stats">${card('Worker Status',statusLabel(),state.engine.busy?'Processing a job':'Local engine')}${card('Current Job',current?titleType(current.type):'None',current?current.target:'Queue is clear')}${card('CPU Usage',state.system.cpuUsage+'%','System-wide sample')}${card('App RAM',bytes(state.system.appRamBytes),'Zaxis Worker process')}${card('Completed Jobs',state.stats.completedJobs||0,`${state.stats.failedJobs||0} failed`)}</div><div class="section worker-banner"><div class="left"><div class="ring">${state.engine.running?'✓':'■'}</div><div><h3>${state.engine.running?'Worker engine is available':'Worker engine is stopped'}</h3><p>${state.engine.running?'Jobs run locally. Close the window and processing can continue in the tray.':'Start the worker to process queued local jobs.'}</p></div></div><div class="actions"><button class="btn primary" onclick="quickJob()">New Local Job</button><button class="btn" onclick="nav('commoncrawl')">Common Crawl</button></div></div><div class="section grid two-col"><div class="card panel"><div class="section-head"><div><h2>Recent Jobs</h2><p>Latest local worker activity</p></div><button class="btn small" onclick="nav('jobs')">View all</button></div>${recentJobs()}</div><div class="card panel"><div class="section-head"><div><h2>Machine</h2><p>Current local environment</p></div></div><div class="metric-list"><div class="metric"><b>${esc(state.system.hostname)}</b><span>Device</span></div><div class="metric"><b>${esc(state.system.arch)}</b><span>Architecture</span></div><div class="metric"><b>${bytes(state.system.totalRamBytes-state.system.freeRamBytes)}</b><span>RAM in use</span></div><div class="metric"><b>${bytes(state.stats.networkDownBytes)}</b><span>Worker data downloaded</span></div><div class="metric"><b>${duration(state.system.uptimeSec)}</b><span>App uptime</span></div><div class="metric"><b>${esc(state.system.platform)}</b><span>Operating system</span></div></div></div></div>`}

function commoncrawl(){setHeader('Common Crawl','Run local index/capture jobs using public Common Crawl data.');return `<div class="grid two-col"><div class="card panel"><div class="section-head"><div><h2>Create Local Job</h2><p>Real Common Crawl index data; no fake analytics.</p></div></div><div class="form-grid"><div class="field"><label>Domain or URL</label><input id="target" class="input" autocomplete="off" spellcheck="false" value="${esc(commonCrawlDraft.target)}" placeholder="example.com or https://example.com/page"></div><div class="field"><label>Job Type</label><select id="jobType" class="select"><option value="capture_lookup" ${commonCrawlDraft.type==='capture_lookup'?'selected':''}>Domain Capture Lookup</option><option value="url_history" ${commonCrawlDraft.type==='url_history'?'selected':''}>Exact URL History</option><option value="live_verify" ${commonCrawlDraft.type==='live_verify'?'selected':''}>Live URL Verification</option></select></div><div class="field"><label>Dataset</label><select id="dataset" class="select"><option value="latest" ${commonCrawlDraft.dataset==='latest'?'selected':''}>Latest automatically</option>${datasets.slice(0,30).map(d=>`<option value="${esc(d.id)}" ${commonCrawlDraft.dataset===d.id?'selected':''}>${esc(d.id)}</option>`).join('')}</select><div class="help">Dataset applies to Common Crawl jobs.</div></div><div class="field"><label>Provider</label><input class="input" value="Common Crawl / Live HTTP" disabled></div></div><div class="actions" style="margin-top:16px"><button class="btn primary" onclick="createJob()">Run Local Job</button><button class="btn" onclick="loadDatasets(true)">Refresh Datasets</button></div></div><div class="card panel"><h2 style="margin-top:0">Part 1 capability</h2><div class="notice">Domain Capture Lookup and URL History use the live Common Crawl index. Live URL Verification performs a real HTTP check.</div><div class="notice warn" style="margin-top:10px"><b>Backlink Discovery:</b> not faked in this build. Reverse-link discovery needs the bulk WAT/link pipeline. The provider architecture is ready for that next worker module.</div><div class="section-head" style="margin-top:18px"><div><h2>Latest Common Crawl datasets</h2></div></div><div>${datasets.length?datasets.slice(0,7).map((d,i)=>`<div class="toggle-row"><div><b>${esc(d.id)}</b><div class="muted">${esc(d.name||'Common Crawl collection')}</div></div>${i===0?'<span class="status-chip completed">Latest</span>':''}</div>`).join(''):'<div class="empty">Click Refresh Datasets to load live collections.</div>'}</div></div></div>`}

function jobs(){setHeader('Jobs','Queued, running, completed and failed local jobs.');return `<div class="card panel"><div class="section-head"><div><h2>Job Queue</h2><p>${state.jobs.length} total jobs</p></div><button class="btn primary small" onclick="nav('commoncrawl')">New job</button></div>${recentJobs(100)}</div>`}
function results(){setHeader('Results','Inspect and export real worker results.');const done=state.jobs.filter(j=>j.resultFile);return `<div class="card panel"><table class="table"><thead><tr><th>Job</th><th>Target</th><th>Results</th><th>Finished</th><th></th></tr></thead><tbody>${done.map(j=>`<tr><td>${esc(titleType(j.type))}</td><td>${esc(j.target)}</td><td>${j.resultsFound}</td><td>${j.finishedAt?new Date(j.finishedAt).toLocaleString():''}</td><td><button class="btn small" onclick="openJob('${j.id}')">Open</button> <button class="btn small" onclick="exportJob('${j.id}')">Export</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No completed results yet.</td></tr>'}</tbody></table></div>`}
function logs(){setHeader('Logs','In-app worker, provider, network and error logs.');return `<div class="card panel"><div class="section-head"><div><h2>Activity Logs</h2><p>Newest first</p></div><div class="actions"><button class="btn small" onclick="exportLogs()">Export</button><button class="btn danger small" onclick="clearLogs()">Clear</button></div></div><div>${state.logs.length?state.logs.map(l=>`<div class="log-line"><span>${new Date(l.ts).toLocaleString()}</span><span class="log-level ${esc(l.level)}">${esc(l.level.toUpperCase())}</span><span>${esc(l.source)}</span><span>${esc(l.message)}</span></div>`).join(''):'<div class="empty">No logs.</div>'}</div></div>`}
function toggle(key,label,desc){const on=!!state.settings[key];return `<div class="toggle-row"><div><b>${label}</b><div class="muted">${desc}</div></div><div class="switch ${on?'on':''}" onclick="toggleSetting('${key}',${!on})"></div></div>`}
function connectionStatus(){
  const c=state.connection||{};
  if(c.status==='connected') return '<span class="status-chip completed">Connected</span>';
  if(c.status==='connecting') return '<span class="status-chip running">Connecting</span>';
  if(c.status==='error') return '<span class="status-chip failed">Connection Error</span>';
  return '<span class="status-chip">Not Connected</span>';
}

function settings(){
  setHeader('Settings','Startup, Zaxis connection, resources and local worker preferences.');
  const conn=state.connection||{};
  const connected=conn.status==='connected'&&conn.workerId;
  return `<div class="grid two-col">
    <div>
      <div class="card panel">
        <div class="section-head"><div><h2>General</h2><p>Windows startup and background behavior</p></div></div>
        ${toggle('startWithWindows','Start Zaxis Worker with Windows','Launch automatically when you sign in.')}
        ${toggle('launchMinimized','Launch minimized','Start quietly in the background.')}
        ${toggle('runInBackground','Keep running when window is closed','Close button hides to tray instead of stopping.')}
        ${toggle('showTrayIcon','Show system tray icon','Quick access to worker controls.')}
        ${toggle('notifications','Windows notifications','Show job completion and failure alerts.')}
        ${toggle('autoStartWorker','Automatically start worker engine','Engine becomes Ready when the app opens.')}
      </div>

      <div class="card panel section">
        <div class="section-head">
          <div><h2>Zaxis Connection</h2><p>Pair this Windows worker with your Zaxis Tools website.</p></div>
          ${connectionStatus()}
        </div>

        ${connected?`
          <div class="connection-summary">
            <div class="metric"><b>${esc(conn.workerName||'Zaxis Worker')}</b><span>Worker name</span></div>
            <div class="metric"><b>${esc(conn.workerId)}</b><span>Worker ID</span></div>
            <div class="metric"><b>${esc(conn.deviceId)}</b><span>Device ID</span></div>
            <div class="metric"><b>${conn.lastHeartbeat?new Date(conn.lastHeartbeat).toLocaleString():'Waiting…'}</b><span>Last heartbeat</span></div>
          </div>
          <div class="field" style="margin-top:14px"><label>Zaxis Server</label><input class="input" value="${esc(conn.serverUrl)}" disabled></div>
          ${conn.lastError?`<div class="notice warn" style="margin-top:12px">${esc(conn.lastError)}</div>`:''}
          <div class="actions" style="margin-top:14px">
            <button class="btn" onclick="testZaxisConnection()">Test Connection</button>
            <button class="btn danger" onclick="disconnectZaxis()">Disconnect</button>
          </div>
        `:`
          <div class="notice">
            In Zaxis Admin open <b>Web Intelligence → Workers → Add Worker</b>, generate a one-time pairing code, then enter it here.
          </div>
          ${conn.lastError?`<div class="notice warn" style="margin-top:10px">${esc(conn.lastError)}</div>`:''}
          <div class="form-grid" style="margin-top:14px">
            <div class="field">
              <label>Zaxis Server URL</label>
              <input id="zaxisServerUrl" class="input" autocomplete="off" spellcheck="false" value="${esc(conn.serverUrl||'https://zaxismedia.vercel.app')}" placeholder="https://your-tools-domain.com">
            </div>
            <div class="field">
              <label>Worker Name</label>
              <input id="zaxisWorkerName" class="input" autocomplete="off" value="${esc(conn.workerName||state.system.hostname)}" placeholder="Saqib Laptop Worker">
            </div>
            <div class="field">
              <label>Pairing Code</label>
              <input id="zaxisPairingCode" class="input code-input" autocomplete="off" spellcheck="false" placeholder="ZAXIS-XXXX-XXXX">
              <div class="help">This one-time code will be generated by the Zaxis website. It is never stored after pairing.</div>
            </div>
            <div class="field">
              <label>Device ID</label>
              <input class="input" value="${esc(conn.deviceId||'Creating device ID…')}" disabled>
            </div>
          </div>
          <div class="actions" style="margin-top:14px">
            <button class="btn primary" onclick="connectZaxis()">Connect to Zaxis</button>
            <button class="btn" onclick="testZaxisServer()">Test Server</button>
          </div>
        `}
      </div>
    </div>

    <div>
      <div class="card panel">
        <div class="section-head"><div><h2>Resource Limits</h2><p>Saved for worker scheduling</p></div></div>
        <div class="field"><label>Maximum CPU target</label><select class="select" onchange="saveSetting('cpuLimit',Number(this.value))"><option ${state.settings.cpuLimit===25?'selected':''}>25</option><option ${state.settings.cpuLimit===50?'selected':''}>50</option><option ${state.settings.cpuLimit===75?'selected':''}>75</option><option ${state.settings.cpuLimit===100?'selected':''}>100</option></select></div>
        <div class="field" style="margin-top:12px"><label>RAM limit (GB)</label><select class="select" onchange="saveSetting('ramLimitGb',Number(this.value))"><option ${state.settings.ramLimitGb===1?'selected':''}>1</option><option ${state.settings.ramLimitGb===2?'selected':''}>2</option><option ${state.settings.ramLimitGb===4?'selected':''}>4</option><option ${state.settings.ramLimitGb===8?'selected':''}>8</option></select></div>
        <div class="field" style="margin-top:12px"><label>Concurrent network requests</label><input class="input" type="number" min="1" max="32" value="${state.settings.networkConcurrency}" onchange="saveSetting('networkConcurrency',Number(this.value))"></div>
        <div class="field" style="margin-top:12px"><label>Live verify timeout (ms)</label><input class="input" type="number" min="2000" max="60000" value="${state.settings.verifyTimeoutMs}" onchange="saveSetting('verifyTimeoutMs',Number(this.value))"></div>
      </div>
      <div class="card panel section">
        <h2 style="margin-top:0">Remote Job Readiness</h2>
        <div class="notice">
          Once paired, this desktop app can heartbeat to Zaxis, poll for remote jobs, accept supported jobs, send progress, upload results, and report completion/failure.
        </div>
        <div class="metric-list" style="margin-top:12px">
          <div class="metric"><b>15 sec</b><span>Heartbeat interval</span></div>
          <div class="metric"><b>8 sec</b><span>Remote job polling</span></div>
          <div class="metric"><b>Secure</b><span>Windows-encrypted token storage</span></div>
          <div class="metric"><b>HTTPS</b><span>No inbound laptop port required</span></div>
        </div>
      </div>
      <div class="card panel section">
        <h2 style="margin-top:0">Local Data</h2>
        <p class="muted">${esc(state.system.dataPath)}</p>
        <button class="btn" onclick="openData()">Open Data Folder</button>
      </div>
    </div>
  </div>`;
}

function jobDetail(){const j=state.jobs.find(x=>x.id===selectedJob);if(!j){setHeader('Job','Job not found');return '<div class="card panel empty">Job not found.</div>'}setHeader(titleType(j.type),j.target);const data=selectedResult,items=data?.items||[];return `<div class="card panel"><div class="section-head"><div><h2>${esc(titleType(j.type))}</h2><p>${esc(j.target)} · ${esc(j.meta?.dataset||j.dataset||'')}</p></div><div class="actions">${['failed','cancelled','interrupted','paused'].includes(j.status)?`<button class="btn" onclick="jobAction('${j.id}','retry')">Retry</button>`:''}${j.status==='running'?`<button class="btn danger" onclick="jobAction('${j.id}','cancel')">Cancel</button>`:''}${data?`<button class="btn" onclick="exportJob('${j.id}')">Export</button>`:''}<button class="btn" onclick="backFromJob()">Back</button></div></div><div class="grid stats" style="grid-template-columns:repeat(4,1fr)">${card('Status',j.status,j.stage)}${card('Progress',(j.progress||0)+'%',j.indeterminate?'Indeterminate':'')}${card('Processed',j.processed||0,j.total?`of ${j.total}`:'')}${card('Results',j.resultsFound||0,j.message||'')}</div>${data?`<div class="section result-view"><table class="table"><thead><tr>${items.length?Object.keys(items[0]).slice(0,7).map(k=>`<th>${esc(k)}</th>`).join(''):'<th>Result</th>'}</tr></thead><tbody>${items.slice(0,1000).map(row=>`<tr>${Object.keys(row).slice(0,7).map(k=>`<td>${esc(typeof row[k]==='object'?JSON.stringify(row[k]):row[k])}</td>`).join('')}</tr>`).join('')||'<tr><td class="empty">No result rows.</td></tr>'}</tbody></table></div>`:`<div class="empty">${j.status==='completed'?'No saved result rows.':'Job is still processing. Results will appear here automatically.'}</div>`}</div>`}
function render(){if(!state)return;captureCommonCrawlDraft();let html='';if(page==='dashboard')html=dashboard();if(page==='jobs')html=jobs();if(page==='commoncrawl')html=commoncrawl();if(page==='results')html=results();if(page==='logs')html=logs();if(page==='settings')html=settings();if(page==='job')html=jobDetail();$('#content').innerHTML=html;}

window.nav=nav; window.quickJob=()=>nav('commoncrawl');
window.createJob=async()=>{captureCommonCrawlDraft();const target=commonCrawlDraft.target.trim(),type=commonCrawlDraft.type,dataset=commonCrawlDraft.dataset;if(!target)return toast('Enter a domain or URL.');try{await window.zaxis.createJob({target,type,dataset,provider:type==='live_verify'?'Live HTTP':'Common Crawl'});commonCrawlDraft.target='';toast('Job queued and worker started.');nav('jobs')}catch(e){toast(e.message)}};
window.loadDatasets=async(show=false)=>{try{datasets=await window.zaxis.listDatasets();if(show)toast(`Loaded ${datasets.length} datasets.`);render()}catch(e){toast('Could not load datasets: '+e.message)}};
window.toggleSetting=async(k,v)=>{await window.zaxis.saveSettings({[k]:v});toast('Setting saved.')};
window.connectZaxis=async()=>{
  const serverUrl=$('#zaxisServerUrl')?.value.trim();
  const workerName=$('#zaxisWorkerName')?.value.trim();
  const pairingCode=$('#zaxisPairingCode')?.value.trim();
  if(!serverUrl||!workerName||!pairingCode)return toast('Server URL, Worker Name and Pairing Code are required.');
  try{
    toast('Connecting to Zaxis…');
    await window.zaxis.pairZaxis({serverUrl,workerName,pairingCode});
    state=await window.zaxis.getState();
    renderTop();render();
    toast('Connected to Zaxis successfully.');
  }catch(e){toast('Connection failed: '+e.message)}
};
window.testZaxisServer=async()=>{
  const serverUrl=$('#zaxisServerUrl')?.value.trim();
  if(!serverUrl)return toast('Enter the Zaxis Server URL.');
  try{const r=await window.zaxis.testZaxis(serverUrl);toast(r.message||'Server is reachable.')}catch(e){toast('Server test failed: '+e.message)}
};
window.testZaxisConnection=async()=>{
  try{const r=await window.zaxis.testZaxis(state.connection?.serverUrl);toast(r.message||'Connection is healthy.')}catch(e){toast('Connection test failed: '+e.message)}
};
window.disconnectZaxis=async()=>{
  try{await window.zaxis.disconnectZaxis();state=await window.zaxis.getState();renderTop();render();toast('Zaxis worker disconnected.')}catch(e){toast(e.message)}
};window.saveSetting=async(k,v)=>{await window.zaxis.saveSettings({[k]:v});toast('Setting saved.')};window.openData=()=>window.zaxis.openDataFolder();window.clearLogs=async()=>{await window.zaxis.clearLogs();toast('Logs cleared.')};window.exportLogs=async()=>{const p=await window.zaxis.exportLogs();if(p)toast('Logs exported.')};window.exportJob=async id=>{const p=await window.zaxis.exportResult(id);if(p)toast('Results exported.')};
window.openJob=async id=>{captureCommonCrawlDraft();jobBackPage=page==='results'?'results':'jobs';selectedJob=id;selectedResult=null;page='job';try{selectedResult=await window.zaxis.getResult(id)}catch{}render()};
window.backFromJob=()=>{selectedJob=null;selectedResult=null;nav(jobBackPage)};
window.jobAction=async(id,a)=>{await window.zaxis.jobAction(id,a);toast(a==='retry'?'Job re-queued.':'Job updated.');nav('jobs')};
(async()=>{state=await window.zaxis.getState();renderTop();render();loadDatasets(false)})();
