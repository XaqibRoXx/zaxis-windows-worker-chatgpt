const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../app/storage/state');

const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zaxis-worker-test-'));
const store = new StateStore(dir);
assert.equal(store.getSettings().runInBackground, true);
const job = store.createJob({type:'capture_lookup',target:'example.com'});
assert.equal(job.status,'queued');
store.updateJob(job.id,{status:'completed',progress:100});
store.setResult(job.id,{items:[{url:'https://example.com'}]});
assert.equal(store.getResult(job.id).items.length,1);
store.addLog('info','Test','works',job.id);
assert.equal(store.getState().logs[0].message,'works');
console.log('core storage test: PASS');
