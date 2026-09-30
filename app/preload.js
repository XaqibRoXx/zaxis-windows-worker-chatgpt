const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('zaxis', {
  getState:()=>ipcRenderer.invoke('get-state'),
  workerAction:(action)=>ipcRenderer.invoke('worker-action',action),
  createJob:(input)=>ipcRenderer.invoke('create-job',input),
  jobAction:(id,action)=>ipcRenderer.invoke('job-action',{id,action}),
  getResult:(id)=>ipcRenderer.invoke('get-result',id),
  saveSettings:(patch)=>ipcRenderer.invoke('save-settings',patch),
  pairZaxis:(input)=>ipcRenderer.invoke('zaxis-pair',input),
  testZaxis:(serverUrl)=>ipcRenderer.invoke('zaxis-test',serverUrl),
  disconnectZaxis:()=>ipcRenderer.invoke('zaxis-disconnect'),
  listDatasets:()=>ipcRenderer.invoke('list-datasets'),
  clearLogs:()=>ipcRenderer.invoke('clear-logs'),
  openDataFolder:()=>ipcRenderer.invoke('open-data-folder'),
  exportResult:(id)=>ipcRenderer.invoke('export-result',id),
  exportLogs:()=>ipcRenderer.invoke('export-logs'),
  onState:(cb)=>ipcRenderer.on('state-updated',(_e,s)=>cb(s)),
  onNavigate:(cb)=>ipcRenderer.on('navigate',(_e,p)=>cb(p))
});
