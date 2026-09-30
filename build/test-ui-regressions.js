const assert = require('assert');
const fs = require('fs');
const path = require('path');

const renderer = fs.readFileSync(path.join(__dirname,'../app/ui/renderer.js'),'utf8');

assert(renderer.includes('function isEditing()'),'editing guard missing');
assert(renderer.includes("if(!isEditing())render()"),'state updates still rerender active form controls');
assert(renderer.includes('commonCrawlDraft'),'Common Crawl form draft persistence missing');
assert(renderer.includes("page='job'"),'persistent job detail view missing');
assert(renderer.includes('autocomplete="off"'),'target input hardening missing');

console.log('ui regression guards: PASS');
