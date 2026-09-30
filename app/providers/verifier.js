const { URL } = require('url');

async function verifyOne(target, timeoutMs = 12000, externalSignal = null) {
  let input = String(target || '').trim();
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  new URL(input);

  const controller = new AbortController();
  const abortFromOutside = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromOutside, { once:true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    let res;
    try {
      res = await fetch(input, {
        method:'HEAD',
        redirect:'follow',
        signal:controller.signal,
        headers:{'User-Agent':'ZaxisWorker/1.0'}
      });
      if ([403,405].includes(res.status)) throw new Error('HEAD rejected');
    } catch (err) {
      if (controller.signal.aborted) throw err;
      res = await fetch(input, {
        method:'GET',
        redirect:'follow',
        signal:controller.signal,
        headers:{'User-Agent':'ZaxisWorker/1.0'}
      });
    }

    const status = res.status;
    return {
      input,
      finalUrl:res.url || input,
      httpStatus:status,
      status:status >= 200 && status < 400 ? (res.url && res.url !== input ? 'Redirected' : 'Live') : 'Unreachable',
      durationMs:Date.now() - started,
      verifiedAt:new Date().toISOString()
    };
  } catch (err) {
    if (externalSignal?.aborted) throw err;
    return {
      input,
      finalUrl:null,
      httpStatus:null,
      status:err.name === 'AbortError' ? 'Timeout' : 'Error',
      error:err.message,
      durationMs:Date.now() - started,
      verifiedAt:new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromOutside);
  }
}

module.exports = { verifyOne };
