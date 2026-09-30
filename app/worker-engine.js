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
  }

  start() {
    this.running = true;
    this.paused = false;
    this.emitState();
    this.store.addLog('info','Worker','Worker engine started');
    this.pump();
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.abortController) this.abortController.abort();
    this.store.addLog('info','Worker','Worker engine stopped');
    this.emitState();
  }

  pause() { this.paused = true; this.store.addLog('info','Worker','Worker paused'); this.emitState(); }
  resume() { this.paused = false; this.store.addLog('info','Worker','Worker resumed'); this.emitState(); this.pump(); }

  cancel(jobId) {
    if (this.current?.id === jobId && this.abortController) this.abortController.abort();
    const job = this.store.updateJob(jobId, { status:'cancelled', stage:'Cancelled', finishedAt:new Date().toISOString(), message:'Cancelled by user' });
    this.emit('job', job);
  }

  status() {
    return { running: this.running, paused: this.paused, busy: !!this.current, currentJobId: this.current?.id || null };
  }
  emitState(){ this.emit('state', this.status()); }

  async pump() {
    if (!this.running || this.paused || this.current) return;
    const job = this.store.getState().jobs.find(j => j.status === 'queued');
    if (!job) { this.emitState(); return; }
    await this.runJob(job);
    setTimeout(() => this.pump(), 80);
  }

  async runJob(job) {
    this.current = job;
    this.abortController = new AbortController();
    this.store.updateJob(job.id, { status:'running', stage:'Preparing', progress:2, startedAt:new Date().toISOString(), message:'' });
    this.store.addLog('info','Job',`Started ${job.type} for ${job.target}`,job.id);
    this.emitState(); this.emit('job', this.store.getState().jobs.find(j=>j.id===job.id));
    const onProgress = (p) => {
      const updated = this.store.updateJob(job.id, { ...p, status:'running', progress: Math.max(0, Math.min(99, p.progress ?? 0)) });
      this.emit('job', updated);
    };
    const onBytes = (n) => { this.store.bumpStat('networkDownBytes', n); this.emit('stats', this.store.getState().stats); };

    try {
      let result;
      if (job.type === 'capture_lookup') {
        result = await captureLookup({ target:job.target, dataset:job.dataset, onProgress, onBytes, signal:this.abortController.signal });
      } else if (job.type === 'url_history') {
        result = await urlHistory({ target:job.target, dataset:job.dataset, onProgress, onBytes, signal:this.abortController.signal });
      } else if (job.type === 'live_verify') {
        onProgress({ stage:'Verifying live URL', progress:40, processed:0, total:1 });
        const item = await verifyOne(job.target, this.store.getSettings().verifyTimeoutMs);
        result = { items:[item], collection:null };
        onProgress({ stage:'Saving results', progress:92, processed:1, total:1 });
      } else {
        throw new Error('This job type is not enabled in Part 1. Common Crawl reverse-link discovery needs the bulk WAT/link pipeline and will be added without fake results.');
      }
      this.store.setResult(job.id, result);
      const finalJob = this.store.updateJob(job.id, {
        status:'completed', stage:'Complete', progress:100, indeterminate:false, finishedAt:new Date().toISOString(),
        processed: result.items?.length || 0, total: result.items?.length || 0, resultsFound: result.items?.length || 0,
        meta: { ...(job.meta||{}), dataset: result.collection?.id || job.dataset }
      });
      this.store.bumpStat('completedJobs',1);
      this.store.addLog('info','Job',`Completed ${job.type}; ${finalJob.resultsFound} result(s)`,job.id);
      this.emit('completed', finalJob);
      this.emit('job', finalJob);
    } catch (err) {
      const cancelled = /cancel/i.test(err.message) || this.abortController.signal.aborted;
      const failed = this.store.updateJob(job.id, { status: cancelled ? 'cancelled':'failed', stage: cancelled?'Cancelled':'Failed', finishedAt:new Date().toISOString(), message:err.message, errors:(job.errors||0)+1 });
      if (!cancelled) this.store.bumpStat('failedJobs',1);
      this.store.addLog(cancelled?'warning':'error','Job',err.message,job.id);
      this.emit('job', failed);
      this.emit(cancelled?'cancelled':'failed', failed);
    } finally {
      this.current = null;
      this.abortController = null;
      this.emitState();
    }
  }
}

module.exports = { WorkerEngine };
