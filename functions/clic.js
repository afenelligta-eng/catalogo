// Registro del clic en "Pedir por WhatsApp".
//
// La landing manda el clic acá con sendBeacon (no frena la apertura de WhatsApp). Esta función
// le agrega lo que el navegador no puede saber con certeza: la IP pública real del cliente y su
// user agent tal como llegó al servidor. Después lo reenvía al Apps Script, que lo guarda y
// manda el Lead por la API de Conversiones.
//
// Por qué la IP se toma acá: la IP y el navegador que Meta usa para atribuir la compra tienen que
// ser los del CLIENTE en el momento del clic, nunca los de tu celular cuando cargás la venta en la PWA.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const TIMEOUT_MS = 8500;
const MAX_BODY = 8000;

function ipCliente(event) {
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || h['client-ip'] || '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : '';
}

exports.handler = async (event) => {
  const ok = { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  if (!APPS_SCRIPT_URL) return ok;

  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_BODY) return { statusCode: 413, body: '' };

  let data;
  try { data = JSON.parse(raw); } catch (e) { return { statusCode: 400, body: '' }; }
  if (!data || data.action !== 'clic' || typeof data.codigo !== 'string') return { statusCode: 400, body: '' };

  data.ip = ipCliente(event);
  const uaServidor = (event.headers || {})['user-agent'];
  if (uaServidor) data.ua = String(uaServidor).slice(0, 400);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
      redirect: 'follow',
      signal: ctl.signal
    });
  } catch (e) {
    console.error('clic: no llegó al Apps Script', data.codigo, e && e.message);
  } finally {
    clearTimeout(timer);
  }
  return ok;
};

exports._test = { ipCliente };
