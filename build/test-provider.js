const assert = require('assert');
let calls=[];
global.fetch = async (url, opts={}) => {
  calls.push(String(url));
  if (String(url).includes('collinfo.json')) return { ok:true, status:200, text:async()=>JSON.stringify([{id:'CC-MAIN-TEST',name:'Test', 'cdx-api':'https://index.test/CC-MAIN-TEST-index'}]) };
  return { ok:true, status:200, text:async()=>JSON.stringify({url:'https://example.com/',timestamp:'20260930010101',status:'200',mime:'text/html',filename:'crawl-data/test.warc.gz',offset:'1',length:'2'})+'\n' };
};
const cc=require('../app/providers/commoncrawl');
(async()=>{
 const r=await cc.captureLookup({target:'example.com',dataset:'latest'});
 assert.equal(r.collection.id,'CC-MAIN-TEST');
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].url,'https://example.com/');
 assert(calls.some(x=>x.includes('url=example.com%2F*')));
 console.log('common crawl provider test: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
