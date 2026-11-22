const MAX_REQUEST_BYTES = 1024 * 1024;
const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (!env.TELEGRAM_WEBHOOK_SECRET || !env.APPS_SCRIPT_WEBHOOK_SECRET ||
        !env.APPS_SCRIPT_WEB_APP_URL) {
      return new Response('Worker is not configured', { status: 503 });
    }
    if (request.headers.get(TELEGRAM_SECRET_HEADER) !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 403 });
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return new Response('Request too large', { status: 413 });
    }

    let body;
    let update;
    try {
      body = await request.text();
      if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
        return new Response('Request too large', { status: 413 });
      }
      update = JSON.parse(body);
    } catch (error) {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (!update || !Number.isSafeInteger(Number(update.update_id))) {
      return new Response('Invalid Telegram update', { status: 400 });
    }

    let destination;
    try {
      destination = new URL(env.APPS_SCRIPT_WEB_APP_URL);
    } catch (error) {
      return new Response('Invalid Apps Script URL', { status: 503 });
    }
    if (destination.protocol !== 'https:' ||
        destination.hostname !== 'script.google.com' ||
        !/^\/(?:macros\/s\/[^/]+\/exec|a\/macros\/[^/]+\/s\/[^/]+\/exec)$/.test(destination.pathname)) {
      return new Response('Invalid Apps Script URL', { status: 503 });
    }
    destination.searchParams.set('key', env.APPS_SCRIPT_WEBHOOK_SECRET);

    let upstream;
    try {
      upstream = await fetch(destination.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow'
      });
    } catch (error) {
      return new Response('Apps Script forwarding failed', { status: 502 });
    }

    const result = await upstream.text();
    if (upstream.status >= 200 && upstream.status < 300 &&
        (result.trim() === 'OK' || result.trim() === 'Duplicate')) {
      return new Response('OK', { status: 200 });
    }
    return new Response('Apps Script returned an unexpected response', { status: 502 });
  }
};
