const { EventEmitter } = require('events');
const { captureLookup, urlHistory } = require('./providers/commoncrawl');
const { verifyOne } = require('./providers/verifier');

class WorkerEngine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.running = false;
    this.paused = false;
    this.current = null;
    this.abortController = null;
    this.pauseRequested = false;
    this.stopRequested = false;
    this.cancelRequested = false;
  }

  start() {
    if (this.running && !this.paused) return;
    this.running = true;
    this.paused = false;
    this.store.addLog('info','Worker','Worker engine started');
    this.emitState();
    this.pump();
  }

  stop() {
    if (!this.running && !this.current) return;
    this.running = false;
    this.paused = false;
    this.stopRequested = true;
    if (this.abortController) this.abortController.abort();
    this.store.addLog('info','Worker','Worker engine stopped');
    this.emitState();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pauseRequested = true;
    if (this.abortController) this.abortController.abort();
    this.store.addLog('info','Worker', this.current ? 'Pausing current job' : 'Worker paused');
    this.emitState();
  }

  resume() {
    if (!this.running) this.running = true;
    this.paused = false;
    const pausedJob = this.store.getState().jobs.find(j => j.status === 'paused');
    if (pausedJob) this.store.updateJob(pausedJob.id,{status:'queued',stage:'Queued',progress:0,message:'Restarting paused job'});
    this.store.addLog('info','Worker','Worker resumed');
    this.emitState();
    this.pump();
  }

  cancel(jobId) {
    const job = this.store.getState().jobs.find(j => j.id === jobId);
    if (!job) return;
    if (this.current?.id === jobId && this.abortController) {
      this.cancelRequested = true;
      this.store.updateJob(jobId,{stage:'Cancelling',message:'Cancelling…'});
      this.abortController.abort();
    } else {
      const updated=this.store.updateJob(jobId,{status:'cancelled',stage:'Cancelled',finishedAt:new Date().toISOString(),message:'Cancelled by user'});
      this.emit('job',updated);
    }
  }

  status() {
    return { running:this.running, paused:this.paused, busy:!!this.current, currentJobId:this.current?.id||null };
  }

  emitState() { this.emit('state',this.status()); }

  async pump() {
    if (!this.running || this.paused || this.current) return;
    const job=this.store.getState().jobs.find(j=>j.status==='queued');
    if (!job) { this.emitState(); return; }
    await this.runJob(job);
    setTimeout(()=>this.pump(),80);
  }

  async runJob(job) {
    this.current=job;
    this.abortController=new AbortController();
    this.pauseRequested=false;
    this.stopRequested=false;
    this.cancelRequested=false;

    this.store.updateJob(job.id,{
      status:'running',
      stage:'Preparing',
      progress:2,
      startedAt:new Date().toISOString(),
      finishedAt:null,
      message:''
    });

    this.store.addLog('info','Job',`Started ${job.type} for ${job.target}`,job.id);
    this.emitState();
    this.emit('job',this.store.getState().jobs.find(j=>j.id===job.id));

    const onProgress=(p)=>{
      const updated=this.store.updateJob(job.id,{
        ...p,
        status:'running',
        progress:Math.max(0,Math.min(99,p.progress??0))
      });
      this.emit('job',updated);
    };

    const onBytes=(n)=>{
      this.store.bumpStat('networkDownBytes',n);
      this.emit('stats',this.store.getState().stats);
    };

    try {
      let result;

      if(job.type==='capture_lookup'){
        result=await captureLookup({
          target:job.target,
          dataset:job.dataset,
          onProgress,
          onBytes,
          signal:this.abortController.signal
        });
      } else if(job.type==='url_history'){
        result=await urlHistory({
          target:job.target,
          dataset:job.dataset,
          onProgress,
          onBytes,
          signal:this.abortController.signal
        });
      } else if(job.type==='live_verify'){
        onProgress({stage:'Verifying live URL',progress:40,processed:0,total:1});
        const item=await verifyOne(
          job.target,
          this.store.getSettings().verifyTimeoutMs,
          this.abortController.signal
        );
        result={items:[item],collection:null};
        onProgress({stage:'Saving results',progress:92,processed:1,total:1});
      } else {
        throw new Error('This job type is not enabled in Part 1. Common Crawl reverse-link discovery needs the bulk WAT/link pipeline.');
      }

      this.store.setResult(job.id,result);

      const finalJob=this.store.updateJob(job.id,{
        status:'completed',
        stage:'Complete',
        progress:100,
        indeterminate:false,
        finishedAt:new Date().toISOString(),
        processed:result.items?.length||0,
        total:result.items?.length||0,
        resultsFound:result.items?.length||0,
        meta:{...(job.meta||{}),dataset:result.collection?.id||job.dataset}
      });

      this.store.bumpStat('completedJobs',1);
      this.store.addLog('info','Job',`Completed ${job.type}; ${finalJob.resultsFound} result(s)`,job.id);
      this.emit('completed',finalJob);
      this.emit('job',finalJob);
    } catch(err) {
      let status='failed';
      let stage='Failed';
      let level='error';
      let message=err.message;

      if(this.cancelRequested){
        status='cancelled';
        stage='Cancelled';
        level='warning';
        message='Cancelled by user';
      } else if(this.pauseRequested){
        status='paused';
        stage='Paused';
        level='info';
        message='Paused by user; Resume will restart this job';
      } else if(this.stopRequested){
        status='interrupted';
        stage='Interrupted';
        level='warning';
        message='Worker stopped before completion';
      } else if(this.abortController?.signal.aborted){
        status='interrupted';
        stage='Interrupted';
        level='warning';
        message='Job interrupted';
      }

      const updated=this.store.updateJob(job.id,{
        status,
        stage,
        finishedAt:status==='failed'?new Date().toISOString():null,
        message,
        errors:status==='failed'?(job.errors||0)+1:(job.errors||0)
      });

      if(status==='failed') this.store.bumpStat('failedJobs',1);
      this.store.addLog(level,'Job',message,job.id);
      this.emit('job',updated);
      if(status==='failed') this.emit('failed',updated);
    } finally {
      this.current=null;
      this.abortController=null;
      this.pauseRequested=false;
      this.stopRequested=false;
      this.cancelRequested=false;
      this.emitState();
    }
  }
}

module.exports={WorkerEngine};
