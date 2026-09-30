const { URL } = require('url');

async function verifyOne(target, timeoutMs = 12000) {
  let input = String(target || '').trim();
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  new URL(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    let res;
    try {
      res = await fetch(input, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'ZaxisWorker/1.0' } });
      if ([403,405].includes(res.status)) throw new Error('HEAD rejected');
    } catch {
      res = await fetch(input, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'ZaxisWorker/1.0' } });
    }
    const status = res.status;
    return {
      input,
      finalUrl: res.url || input,
      httpStatus: status,
      status: status >= 200 && status < 400 ? (res.url && res.url !== input ? 'Redirected' : 'Live') : 'Unreachable',
      durationMs: Date.now() - started,
      verifiedAt: new Date().toISOString()
    };
  } catch (err) {
    return { input, finalUrl: null, httpStatus: null, status: err.name === 'AbortError' ? 'Timeout' : 'Error', error: err.message, durationMs: Date.now() - started, verifiedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

module.exports = { verifyOne };
