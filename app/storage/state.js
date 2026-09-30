const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

class StateStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    ensureDir(baseDir);
    this.stateFile = path.join(baseDir, 'state.json');
    this.resultsDir = path.join(baseDir, 'results');
    ensureDir(this.resultsDir);
    this.state = this.load();
  }

  defaults() {
    return {
      settings: {
        startWithWindows: false,
        launchMinimized: true,
        runInBackground: true,
        showTrayIcon: true,
        notifications: true,
        autoStartWorker: true,
        cpuLimit: 75,
        ramLimitGb: 4,
        concurrentJobs: 1,
        networkConcurrency: 6,
        pauseOnBattery: false,
        runOnlyWhileCharging: false,
        pauseOnMetered: false,
        commonCrawlDataset: 'latest',
        verifyTimeoutMs: 12000,
        debugLogging: false
      },
      jobs: [],
      logs: [],
      stats: { completedJobs: 0, failedJobs: 0, networkDownBytes: 0, networkUpBytes: 0 },
      app: { firstRun: true }
    };
  }

  load() {
    const base = this.defaults();
    if (!fs.existsSync(this.stateFile)) return base;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        stats: { ...base.stats, ...(parsed.stats || {}) },
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      };
    } catch {
      return base;
    }
  }

  save() {
    const temp = this.stateFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2));
    fs.renameSync(temp, this.stateFile);
  }

  getState() { return this.state; }
  getSettings() { return this.state.settings; }
  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    return this.state.settings;
  }

  addLog(level, source, message, jobId = null) {
    const log = { id: `log_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, ts: new Date().toISOString(), level, source, message, jobId };
    this.state.logs.unshift(log);
    if (this.state.logs.length > 3000) this.state.logs.length = 3000;
    this.save();
    return log;
  }

  clearLogs() { this.state.logs = []; this.save(); }

  createJob(input) {
    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      type: input.type,
      target: input.target,
      provider: input.provider || 'Common Crawl',
      dataset: input.dataset || 'latest',
      status: 'queued',
      stage: 'Queued',
      progress: 0,
      indeterminate: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      processed: 0,
      total: null,
      resultsFound: 0,
      errors: 0,
      message: '',
      resultFile: null,
      meta: {}
    };
    this.state.jobs.unshift(job);
    this.save();
    return job;
  }

  updateJob(id, patch) {
    const job = this.state.jobs.find(j => j.id === id);
    if (!job) return null;
    Object.assign(job, patch);
    this.save();
    return job;
  }

  deleteJob(id) {
    this.state.jobs = this.state.jobs.filter(j => j.id !== id || ['running','paused'].includes(j.status));
    this.save();
  }

  setResult(id, data) {
    const file = path.join(this.resultsDir, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    this.updateJob(id, { resultFile: file, resultsFound: Array.isArray(data) ? data.length : (data.items?.length || 0) });
    return file;
  }

  getResult(id) {
    const job = this.state.jobs.find(j => j.id === id);
    if (!job || !job.resultFile || !fs.existsSync(job.resultFile)) return null;
    try { return JSON.parse(fs.readFileSync(job.resultFile, 'utf8')); } catch { return null; }
  }

  bumpStat(key, amount = 1) {
    this.state.stats[key] = (this.state.stats[key] || 0) + amount;
    this.save();
  }
}

module.exports = { StateStore };
