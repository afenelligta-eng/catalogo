// Catálogo para la landing: intermediario rápido delante del Apps Script.
//
//  - El CDN de Netlify guarda la respuesta 30 s: casi ningún visitante espera el arranque en frío de Apps Script.
//  - Un cambio hecho en la PWA (precio, stock, fotos) llega a la landing en ~1 minuto como máximo
//    (30 s del CDN + hasta 60 s de caché interna del Apps Script).
//  - Si Apps Script falla o tarda, devuelve el último catálogo bueno que esta instancia conoció.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const TIMEOUT_MS = 7000; // Netlify corta las funciones a los 10 s

let ultimoBueno = null;

function responder(status, body, cache) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };
  if (cache) {
    h['Cache-Control'] = 'public, max-age=0, must-revalidate';
    h['Netlify-CDN-Cache-Control'] = 'public, s-maxage=30, stale-while-revalidate=60';
  } else {
    h['Cache-Control'] = 'no-store';
  }
  return { statusCode: status, headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

exports.handler = async () => {
  if (!APPS_SCRIPT_URL) return responder(503, { success: false, message: 'falta-APPS_SCRIPT_URL' }, false);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=getCatalog`, { signal: ctl.signal });
    const texto = await res.text();
    const data = JSON.parse(texto);
    if (data && data.success && Array.isArray(data.productos)) {
      ultimoBueno = texto;
      return responder(200, texto, true);
    }
  } catch (e) {
    /* cae al último catálogo bueno */
  } finally {
    clearTimeout(timer);
  }
  if (ultimoBueno) return responder(200, ultimoBueno, false);
  return responder(502, { success: false, message: 'catalogo-no-disponible' }, false);
};
