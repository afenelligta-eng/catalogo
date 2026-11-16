/**
 * BACKEND DE LA TIENDA (Google Apps Script + Google Sheets)
 *
 * Qué hace:
 *  - Sirve el catálogo a la landing (productos, colores, fotos, stock, config).
 *  - Registra cada clic en "Pedir por WhatsApp" con su código único, fbc, fbp, IP y navegador.
 *  - Manda Lead (al clic) y Purchase (cuando marcás la venta) a la API de Conversiones de Meta.
 *  - Expone acciones de administración para la PWA: productos, variantes, stock, fotos, config, ventas.
 *
 * INSTALACIÓN (una sola vez):
 *  1. Creá una planilla nueva → Extensiones → Apps Script → pegá este archivo.
 *  2. Ejecutá la función setup() (te pide permisos de Sheets, Drive y conexiones externas).
 *     Crea las hojas y carga productos de ejemplo. Después ejecutá crearAcceso() (archivo Acceso.gs) para fijar usuario y clave.
 *  3. Configuración del proyecto → Propiedades del script → agregá CAPI_TOKEN (token de la API
 *     de Conversiones). El token NUNCA va en la planilla ni en la landing.
 *  4. Hoja "Config": completá numero, pixelId, datasetId, marca y textos.
 *  5. Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo,
 *     Acceso: Cualquier usuario. Copiá la URL /exec y ponela en Netlify (variable APPS_SCRIPT_URL).
 *  Cada vez que cambies este código: Implementar → Gestionar implementaciones → Editar → Versión nueva.
 */

/* ======================= estructura de la planilla ======================= */
var H = {
  // categoria / tipo / componentes / guia_cols se agregan al final para no romper planillas ya creadas (setup() las completa).
  Productos: ['id', 'nombre', 'precio', 'precio_antes', 'descripcion', 'calce', 'tela', 'guia_talles', 'etiqueta', 'activo', 'orden',
              'categoria', 'tipo', 'componentes', 'guia_cols'],
  // Después de "imagenes", cada columna es un talle. Celda vacía = ese talle no existe para el color; 0 = agotado.
  Variantes: ['producto_id', 'color', 'hex', 'imagenes', 'S', 'M', 'L', 'XL', 'XXL'],
  Config: ['clave', 'valor', 'nota'],
  Clics: ['fecha', 'codigo', 'uuid', 'producto_id', 'producto', 'color', 'talle', 'cantidad', 'precio', 'valor',
          'fbc', 'fbp', 'ip', 'user_agent', 'pagina', 'fbclid', 'utm_source', 'utm_campaign', 'utm_content',
          'ad_id', 'adset_id', 'campaign_id', 'lead_event_id', 'capi_lead', 'estado', 'items'],
  Ventas: ['fecha', 'codigo', 'telefono', 'monto', 'producto_id', 'producto', 'color', 'talle', 'cantidad',
           'event_id', 'capi_estado', 'capi_respuesta', 'nota', 'ciudad', 'items'],
  'Reseñas': ['nombre', 'texto', 'foto', 'activo']
};
var N_FIJAS_VARIANTES = 4;

var CONFIG_DEFAULT = [
  ['marca', 'VEK', 'Nombre de la tienda (título de la pestaña y pie de página)'],
  ['numero', '', 'WhatsApp con formato 549 + característica sin 0 + número sin 15. Ej: 5493774123456'],
  ['pixelId', '', 'ID del Pixel / conjunto de datos para el navegador'],
  ['datasetId', '', 'ID del conjunto de datos para la API de Conversiones (suele ser el mismo que el Pixel)'],
  ['graphVersion', 'v25.0', 'Versión de la Graph API. Actualizala si Meta la da de baja'],
  ['testEventCode', '', 'Código de prueba del Administrador de eventos. Dejalo VACÍO en producción'],
  ['enviarLeadCAPI', 'si', 'si/no: manda Lead por servidor en cada clic (deduplicado con el del navegador)'],
  ['capiFuenteCompra', 'website', 'action_source del Purchase con código: website o chat (ver LEEME)'],
  ['promoTexto', 'Envío gratis en Curuzú Cuatiá', 'Barra de arriba. Vacío = sin barra'],
  ['promoBeneficio', '', 'Si el código da algo (ej. "10% de descuento"), escribilo acá y aparece en la página'],
  ['lede', '', 'Texto bajo la marca. Vacío = texto por defecto'],
  ['envioCorto', 'Envío gratis en Curuzú Cuatiá', ''],
  ['cambioCorto', 'Cambio de talle (sin uso)', ''],
  ['pagoCorto', 'Efectivo o transferencia', ''],
  ['envioTexto', '', 'Respuesta de la pregunta frecuente sobre envíos. Vacío = texto por defecto'],
  ['cambioTexto', '', 'Respuesta sobre cambios'],
  ['pagoTexto', '', 'Respuesta sobre pagos'],
  ['stockBajo', '3', 'Desde cuántas unidades se muestra "Quedan N"'],
  ['mostrarVentasRecientes', 'si', 'si/no: avisos abajo con tus ventas REALES registradas desde la PWA'],
  ['ventasRecientesDias', '14', 'Antigüedad máxima de las ventas que se muestran en los avisos']
];
var CONFIG_PUBLICA = ['marca', 'numero', 'pixelId', 'promoTexto', 'promoBeneficio', 'lede', 'envioCorto', 'cambioCorto',
                      'pagoCorto', 'envioTexto', 'cambioTexto', 'pagoTexto', 'stockBajo'];

var CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/* ======================= entradas web ======================= */
function doGet(e) {
  var a = (e && e.parameter && e.parameter.action) || '';
  try {
    if (a === 'getCatalog') return json(catalogoPublico());
    if (a === 'ping') return json({ success: true, t: new Date().toISOString() });
    return json({ success: false, message: 'accion-desconocida' });
  } catch (err) {
    return json({ success: false, message: String(err && err.message || err) });
  }
}

function doPost(e) {
  var b;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json({ success: false, message: 'json-invalido' }); }
  var a = String(b.action || '');
  try {
    if (a === 'clic') return json(registrarClic(b));
    if (a === 'login') return json(login(b));

    // ---- todo lo demás es de administración (PWA) ----
    if (!esAdmin(b.token)) return json({ success: false, message: 'no-autorizado' });
    switch (a) {
      case 'logout':          return json(logout(b.token));
      case 'cerrarSesiones':  return json(cerrarSesiones());
      case 'cambiarAcceso':   return json(cambiarAcceso(b));
      case 'adminCatalogo':   return json(catalogoAdmin());
      case 'guardarProducto': return json(guardarProducto(b.producto));
      case 'borrarProducto':  return json(borrarProducto(b.id));
      case 'ajustarStock':    return json(ajustarStock(b.productoId, b.color, b.talle, b.delta, b.valor));
      case 'setConfig':       return json(setConfig(b.valores));
      case 'subirImagen':     return json(subirImagen(b.nombre, b.mime, b.base64));
      case 'buscarCodigo':    return json(buscarCodigo(b.codigo));
      case 'registrarVenta':  return json(registrarVenta(b));
      case 'ultimasVentas':   return json(ultimasVentas(b.n));
      case 'ultimosClics':    return json(ultimosClics(b.n));
      case 'guardarResenas':  return json(guardarResenas(b.resenas));
      case 'setSecreto':      return json(setSecreto(b.nombre, b.valor));
      case 'diagnostico':     return json(diagnostico());
      case 'probarEvento':    return json(probarEvento());
      case 'ping':            return json({ success: true, planilla: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
    }
    return json({ success: false, message: 'accion-desconocida' });
  } catch (err) {
    return json({ success: false, message: String(err && err.message || err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================= acceso: usuario + clave → sesión ======================= */
// La clave nunca se guarda: solo un hash con sal en Propiedades del script. Con usuario y clave correctos
// se entrega una sesión al azar (64 caracteres) que dura SESION_DIAS; en el servidor solo se guarda su hash.
var SESION_DIAS = 30, MAX_FALLOS = 8, BLOQUEO_SEG = 900, VUELTAS_HASH = 200;

function hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function hashClave_(clave, sal) {
  var h = hex_(sal + ':' + clave);
  for (var i = 0; i < VUELTAS_HASH; i++) h = hex_(h + sal + clave);
  return h;
}
function igual_(a, b) { // comparación sin cortar en la primera diferencia
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function sesiones_() {
  try { var o = JSON.parse(PropertiesService.getScriptProperties().getProperty('SESIONES') || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch (e) { return {}; }
}
function esAdmin(token) {
  if (typeof token !== 'string' || token.length !== 64) return false;
  var exp = sesiones_()[hex_(token)];
  return !!exp && exp > Date.now();
}
function nuevaSesion_() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var s = sesiones_(), ahora = Date.now(), vivas = [];
    Object.keys(s).forEach(function (k) { if (s[k] > ahora) vivas.push([k, s[k]]); });
    vivas.sort(function (a, b) { return b[1] - a[1]; });
    var out = {};
    vivas.slice(0, 9).forEach(function (x) { out[x[0]] = x[1]; }); // como máximo 10 dispositivos
    out[hex_(token)] = ahora + SESION_DIAS * 86400000;
    PropertiesService.getScriptProperties().setProperty('SESIONES', JSON.stringify(out));
  } finally { lock.releaseLock(); }
  return token;
}
function claveCorrecta_(usuario, clave) {
  var p = PropertiesService.getScriptProperties();
  var okU = igual_(String(usuario || '').trim().toLowerCase(), String(p.getProperty('ADMIN_USER') || '').toLowerCase());
  var okK = igual_(hashClave_(String(clave || ''), String(p.getProperty('ADMIN_SALT') || '')), String(p.getProperty('ADMIN_HASH') || ''));
  return okU && okK;
}
function fallo_() {
  var c = CacheService.getScriptCache(), n = Number(c.get('login_fallos') || 0) + 1;
  c.put('login_fallos', String(n), BLOQUEO_SEG);
  Utilities.sleep(1200);
}
function bloqueado_() { return Number(CacheService.getScriptCache().get('login_fallos') || 0) >= MAX_FALLOS; }

function login(b) {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('ADMIN_HASH')) throw new Error('acceso-sin-configurar');
  if (bloqueado_()) return { success: false, message: 'demasiados-intentos' };
  if (String(b.clave || '').length > 200 || String(b.usuario || '').length > 80) { fallo_(); return { success: false, message: 'credenciales-invalidas' }; }
  if (!claveCorrecta_(b.usuario, b.clave)) { fallo_(); return { success: false, message: 'credenciales-invalidas' }; }
  CacheService.getScriptCache().remove('login_fallos');
  return { success: true, token: nuevaSesion_(), usuario: p.getProperty('ADMIN_USER'), dias: SESION_DIAS };
}
function logout(token) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var s = sesiones_(); delete s[hex_(String(token))];
    PropertiesService.getScriptProperties().setProperty('SESIONES', JSON.stringify(s));
  } finally { lock.releaseLock(); }
  return { success: true };
}
function cerrarSesiones() { PropertiesService.getScriptProperties().deleteProperty('SESIONES'); return { success: true }; }

function validarAcceso_(usuario, clave, minClave) {
  if (usuario.length < 3 || usuario.length > 40) throw new Error('usuario-invalido: entre 3 y 40 caracteres');
  if (clave.length < minClave) throw new Error('clave-corta: mínimo ' + minClave + ' caracteres');
  if (clave.length > 200) throw new Error('clave-larga');
  if (clave.toLowerCase() === usuario.toLowerCase()) throw new Error('clave-igual-al-usuario');
}
// Fija usuario y clave (cierra todas las sesiones y anula el ADMIN_TOKEN viejo).
function fijarAcceso(usuario, clave) {
  usuario = String(usuario || '').trim(); clave = String(clave || '');
  validarAcceso_(usuario, clave, 8);
  var p = PropertiesService.getScriptProperties(), sal = Utilities.getUuid() + Utilities.getUuid();
  p.setProperty('ADMIN_USER', usuario); p.setProperty('ADMIN_SALT', sal); p.setProperty('ADMIN_HASH', hashClave_(clave, sal));
  p.deleteProperty('ADMIN_TOKEN'); p.deleteProperty('SESIONES');
  CacheService.getScriptCache().remove('login_fallos');
}
// Desde el panel: pide la clave actual, cambia usuario y/o clave, y deja abierta solo la sesión actual.
function cambiarAcceso(b) {
  if (bloqueado_()) return { success: false, message: 'demasiados-intentos' };
  var p = PropertiesService.getScriptProperties();
  if (!claveCorrecta_(p.getProperty('ADMIN_USER'), b.actual)) { fallo_(); return { success: false, message: 'clave-actual-incorrecta' }; }
  var usuario = String(b.usuario || '').trim() || p.getProperty('ADMIN_USER'), clave = String(b.nueva || '');
  validarAcceso_(usuario, clave, 10);
  if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) throw new Error('clave-debil: combiná letras y números');
  fijarAcceso(usuario, clave);
  return { success: true, token: nuevaSesion_(), usuario: usuario };
}

/* ======================= hojas: lectura y escritura ======================= */
function hoja(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, H[nombre].length).setValues([H[nombre]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Devuelve { headers, rows: [ {col: valor, _row: n} ] }
function leer(nombre) {
  var sh = hoja(nombre), lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return { headers: [], rows: [] };
  var v = sh.getRange(1, 1, lr, lc).getValues();
  var headers = v[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = { _row: i + 1 };
    headers.forEach(function (h, j) { if (h) o[h] = v[i][j]; });
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function config() {
  var c = {};
  leer('Config').rows.forEach(function (r) { if (r.clave) c[String(r.clave).trim()] = String(r.valor == null ? '' : r.valor).trim(); });
  return c;
}

function si(v) { var s = String(v).trim().toLowerCase(); return s === 'si' || s === 'sí' || s === 'true' || s === '1' || s === 'x'; }

/* ======================= catálogo ======================= */
function parseGuia(txt) { // "S:56x70 | M:59x72"  ->  [{t:'S',a:56,l:70}, ...]
  return String(txt || '').split(/[|;\n]/).map(function (s) {
    var m = s.trim().match(/^([^:]+):\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    return m ? { t: m[1].trim(), a: Number(m[2].replace(',', '.')), l: Number(m[3].replace(',', '.')) } : null;
  }).filter(Boolean);
}

function parseComponentes(t) { // "remera-boxy | cat:Shorts"  ->  [{id:'remera-boxy'}, {cat:'Shorts'}]
  return String(t || '').split('|').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 4).map(function (x) {
    return /^cat:/i.test(x) ? { cat: x.replace(/^cat:\s*/i, '').trim() } : { id: x };
  });
}
function parseCols(t) { // "Cintura|Largo" -> ['Cintura','Largo']
  var a = String(t || '').split('|').map(function (x) { return x.trim().slice(0, 30); });
  return [a[0] || 'Ancho de pecho', a[1] || 'Largo'];
}

function armarCatalogo(incluirInactivos) {
  var prods = leer('Productos').rows, vs = leer('Variantes');
  var talles = vs.headers.slice(N_FIJAS_VARIANTES).filter(Boolean);
  var porProd = {};
  vs.rows.forEach(function (r) {
    var id = String(r.producto_id || '').trim();
    if (!id || !r.color) return;
    var stock = {};
    talles.forEach(function (t) {
      var x = r[t];
      if (x === '' || x === null || x === undefined) return;          // talle inexistente para este color
      stock[t] = Math.max(0, Math.floor(Number(x) || 0));
    });
    (porProd[id] = porProd[id] || []).push({
      color: String(r.color).trim(),
      hex: /^#[0-9a-f]{6}$/i.test(String(r.hex).trim()) ? String(r.hex).trim() : '#C9CCD3',
      imagenes: String(r.imagenes || '').split(/[|\n]/).map(function (u) { return u.trim(); }).filter(function (u) { return /^https:\/\//i.test(u); }),
      stock: stock
    });
  });
  var lista = prods.filter(function (p) { return p.id && p.nombre && (incluirInactivos || si(p.activo)); })
    .sort(function (a, b) { return (Number(a.orden) || 999) - (Number(b.orden) || 999); })
    .map(function (p) {
      var combo = String(p.tipo || '').trim().toLowerCase() === 'combo';
      return {
        id: String(p.id).trim(), nombre: String(p.nombre).trim(),
        tipo: combo ? 'combo' : 'producto', categoria: String(p.categoria || '').trim(),
        componentes: combo ? parseComponentes(p.componentes) : [],
        // En un combo el "precio anterior" NO se guarda: la tienda lo calcula con lo que cuestan por separado las prendas elegidas.
        precio: Number(p.precio) || 0, precioAntes: combo ? 0 : (Number(p.precio_antes) || 0),
        descripcion: String(p.descripcion || ''), calce: String(p.calce || ''), tela: String(p.tela || ''),
        guia: parseGuia(p.guia_talles), guiaCols: parseCols(p.guia_cols), etiqueta: String(p.etiqueta || ''),
        activo: si(p.activo), orden: Number(p.orden) || 0,
        variantes: porProd[String(p.id).trim()] || []
      };
    })
    .filter(function (p) { return incluirInactivos || p.tipo === 'combo' || p.variantes.length; });
  var resenas = leer('Reseñas').rows.filter(function (r) { return si(r.activo) && r.texto; })
    .map(function (r) { return { nombre: String(r.nombre || ''), texto: String(r.texto), foto: String(r.foto || '') }; });
  return { productos: lista, resenas: resenas, talles: talles };
}

function catalogoPublico() {
  var cache = CacheService.getScriptCache(), hit = cache.get('catalogo');
  if (hit) return JSON.parse(hit);
  var c = config(), pub = {};
  CONFIG_PUBLICA.forEach(function (k) { if (c[k] !== undefined) pub[k] = c[k]; });
  var cat = armarCatalogo(false);
  var out = { success: true, config: pub, productos: cat.productos, resenas: cat.resenas,
              actividad: si(c.mostrarVentasRecientes) ? ventasRecientes(Number(c.ventasRecientesDias) || 14) : [],
              t: new Date().toISOString() };
  try { cache.put('catalogo', JSON.stringify(out), 60); } catch (e) { /* catálogo muy grande para la caché: se sirve igual */ }
  return out;
}

// Avisos de la landing: salen de la hoja Ventas (ventas reales). Nunca expone nombre ni teléfono.
function ventasRecientes(dias) {
  var desde = Date.now() - dias * 86400000;
  return leer('Ventas').rows.filter(function (r) {
    return r.fecha instanceof Date && r.fecha.getTime() >= desde && r.producto;
  }).slice(-12).reverse().map(function (r) {
    return { producto: String(r.producto).replace(/\s\+\d+$/, ''), color: String(r.color || ''), ciudad: String(r.ciudad || ''), t: r.fecha.toISOString() };
  });
}

function catalogoAdmin() {
  var cat = armarCatalogo(true), props = PropertiesService.getScriptProperties();
  return {
    success: true, config: config(), productos: cat.productos, talles: cat.talles,
    resenas: leer('Reseñas').rows.map(function (r) { return { nombre: r.nombre, texto: r.texto, foto: r.foto, activo: si(r.activo) }; }),
    capiToken: !!props.getProperty('CAPI_TOKEN')
  };
}

function limpiarCache() { CacheService.getScriptCache().remove('catalogo'); }

/* ======================= administración del catálogo ======================= */
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('p-' + Date.now());
}

/**
 * Crea o reemplaza un producto completo con sus variantes.
 * producto = { id?, nombre, precio, precioAntes, descripcion, calce, tela, guia:[{t,a,l}] | guiaTexto,
 *              etiqueta, activo, orden, variantes:[{ color, hex, imagenes:[], stock:{S:3,M:0} }] }
 */
function guardarProducto(p) {
  if (!p || !p.nombre) throw new Error('falta-nombre');
  if (!(Number(p.precio) > 0)) throw new Error('precio-invalido');
  var esCombo = p.tipo === 'combo', comps = '';
  if (esCombo) {
    var arr = Array.isArray(p.componentes) ? p.componentes : String(p.componentes || '').split('|');
    comps = arr.map(function (x) { return String(x || '').trim().slice(0, 60); }).filter(Boolean).join(' | ');
    var n = parseComponentes(comps).length;
    if (n < 2 || n > 4) throw new Error('combo-invalido: un combo tiene entre 2 y 4 prendas');
  }
  sincronizarEncabezados(); // por si la planilla es de una versión anterior
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = p.id ? slug(p.id) : slug(p.nombre);
    var guia = p.guiaTexto != null ? String(p.guiaTexto)
      : (p.guia || []).map(function (g) { return g.t + ':' + g.a + 'x' + g.l; }).join(' | ');
    // descuento: el precio anterior solo se guarda si es mayor al precio actual
    var antes = Number(p.precioAntes) > Number(p.precio) ? Number(p.precioAntes) : '';
    if (esCombo) antes = '';
    var cols = Array.isArray(p.guiaCols) ? p.guiaCols.join('|') : String(p.guiaCols || '');
    if (/^\s*Ancho de pecho\s*\|\s*Largo\s*$/i.test(cols)) cols = ''; // lo de siempre: no se guarda
    var fila = fila_([id, String(p.nombre).slice(0, 80), Number(p.precio), antes, String(p.descripcion || '').slice(0, 600),
                String(p.calce || ''), String(p.tela || ''), guia, String(p.etiqueta || '').slice(0, 24), p.activo === false ? 'no' : 'si',
                Number(p.orden) || '', String(p.categoria || '').trim().slice(0, 30), esCombo ? 'combo' : '', comps, cols.slice(0, 70)]);
    var sh = hoja('Productos'), prods = leer('Productos').rows;
    var ex = prods.filter(function (r) { return String(r.id).trim() === id; })[0];
    if (ex) sh.getRange(ex._row, 1, 1, fila.length).setValues([fila]);
    else {
      if (!p.id && prods.some(function (r) { return String(r.id).trim() === id; })) id = id + '-' + Date.now().toString(36);
      fila[0] = id; sh.appendRow(fila);
    }
    if (!esCombo && Array.isArray(p.variantes)) escribirVariantes(id, p.variantes);
    limpiarCache();
    return { success: true, id: id };
  } finally { lock.releaseLock(); }
}

function escribirVariantes(id, variantes) {
  var sh = hoja('Variantes'), data = leer('Variantes'), headers = data.headers.slice();
  // talles nuevos -> columnas nuevas
  variantes.forEach(function (v) {
    Object.keys(v.stock || {}).forEach(function (t) {
      t = String(t).trim().toUpperCase().slice(0, 8);
      if (t && headers.indexOf(t) === -1) { headers.push(t); sh.getRange(1, headers.length).setValue(t).setFontWeight('bold'); }
    });
  });
  // borra las filas viejas de este producto (de abajo hacia arriba)
  data.rows.filter(function (r) { return String(r.producto_id).trim() === id; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (n) { sh.deleteRow(n); });
  var filas = variantes.filter(function (v) { return v && v.color; }).map(function (v) {
    var stock = {}; Object.keys(v.stock || {}).forEach(function (t) { stock[String(t).trim().toUpperCase()] = v.stock[t]; });
    return headers.map(function (h, j) {
      if (j === 0) return id;
      if (h === 'color') return String(v.color).slice(0, 40);
      if (h === 'hex') return /^#[0-9a-f]{6}$/i.test(v.hex) ? v.hex : '#C9CCD3';
      if (h === 'imagenes') return (v.imagenes || []).filter(function (u) { return /^https:\/\//i.test(u); }).join(' | ');
      var x = stock[h];
      return (x === undefined || x === null || x === '') ? '' : Math.max(0, Math.floor(Number(x) || 0));
    });
  });
  if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, headers.length).setValues(filas);
}

function borrarProducto(id) {
  id = String(id || '').trim(); if (!id) throw new Error('falta-id');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = hoja('Productos'), r = leer('Productos').rows.filter(function (x) { return String(x.id).trim() === id; })[0];
    if (!r) return { success: false, message: 'no-existe' };
    sh.deleteRow(r._row);
    escribirVariantes(id, []);
    limpiarCache();
    return { success: true };
  } finally { lock.releaseLock(); }
}

// delta: suma/resta. valor: fija el número exacto. Devuelve el stock nuevo.
function ajustarStock(productoId, color, talle, delta, valor) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var r = cambiarStock(productoId, color, talle, delta, valor);
    limpiarCache();
    return r;
  } finally { lock.releaseLock(); }
}

function cambiarStock(productoId, color, talle, delta, valor) {
  var data = leer('Variantes'), col = data.headers.indexOf(String(talle || '').trim().toUpperCase());
  if (col < N_FIJAS_VARIANTES) return { success: false, message: 'talle-inexistente' };
  var fila = data.rows.filter(function (r) {
    return String(r.producto_id).trim() === String(productoId).trim() &&
           String(r.color).trim().toLowerCase() === String(color || '').trim().toLowerCase();
  })[0];
  if (!fila) return { success: false, message: 'variante-inexistente' };
  var actual = Number(fila[data.headers[col]]) || 0;
  var nuevo = valor !== undefined && valor !== null && valor !== '' ? Number(valor) : actual + (Number(delta) || 0);
  nuevo = Math.max(0, Math.floor(nuevo));
  hoja('Variantes').getRange(fila._row, col + 1).setValue(nuevo);
  return { success: true, antes: actual, stock: nuevo };
}

function setConfig(valores) {
  if (!valores || typeof valores !== 'object') throw new Error('sin-valores');
  if (valores.numero && !/^549\d{10}$/.test(String(valores.numero))) throw new Error('numero-invalido: usá 549 + característica + número');
  if (valores.pixelId && !/^\d{10,20}$/.test(String(valores.pixelId))) throw new Error('pixel-invalido: son solo números');
  if (valores.datasetId && !/^\d{10,20}$/.test(String(valores.datasetId))) throw new Error('dataset-invalido: son solo números');
  if (valores.graphVersion && !/^v\d{2}\.0$/.test(String(valores.graphVersion))) throw new Error('version-invalida: formato v25.0');
  if (valores.capiFuenteCompra && ['website', 'chat'].indexOf(String(valores.capiFuenteCompra)) === -1) throw new Error('fuente-invalida: website o chat');
  if (valores.stockBajo !== undefined && valores.stockBajo !== '' && !/^\d{1,3}$/.test(String(valores.stockBajo))) throw new Error('stockBajo-invalido');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = hoja('Config'), rows = leer('Config').rows;
    Object.keys(valores).forEach(function (k) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) return;
      var v = String(valores[k] == null ? '' : valores[k]).slice(0, 500);
      var r = rows.filter(function (x) { return String(x.clave).trim() === k; })[0];
      v = celda_(v);
      if (r) sh.getRange(r._row, 2).setValue(v); else sh.appendRow([k, v, '']);
    });
    limpiarCache();
    return { success: true };
  } finally { lock.releaseLock(); }
}

function guardarResenas(lista) {
  if (!Array.isArray(lista)) throw new Error('sin-resenas');
  var sh = hoja('Reseñas');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H['Reseñas'].length).clearContent();
  var filas = lista.filter(function (r) { return r && r.texto; }).slice(0, 50).map(function (r) {
    return fila_([String(r.nombre || '').slice(0, 60), String(r.texto).slice(0, 400), /^https:\/\//i.test(r.foto || '') ? r.foto : '', r.activo === false ? 'no' : 'si']);
  });
  if (filas.length) sh.getRange(2, 1, filas.length, 4).setValues(filas);
  limpiarCache();
  return { success: true, n: filas.length };
}

// Sube una foto a Drive (carpeta propia, pública solo por enlace) y devuelve una URL para la landing.
function subirImagen(nombre, mime, base64) {
  if (!/^image\/(jpeg|png|webp)$/.test(String(mime))) throw new Error('formato-no-permitido: jpg, png o webp');
  if (!base64 || base64.length > 7000000) throw new Error('imagen-muy-grande: máximo ~5 MB');
  var bytes = Utilities.base64Decode(String(base64).replace(/^data:[^,]+,/, ''));
  var blob = Utilities.newBlob(bytes, mime, String(nombre || 'foto').replace(/[^\w.\-]/g, '_').slice(0, 60));
  var file = carpetaFotos().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true, id: file.getId(), url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

function carpetaFotos() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('CARPETA_FOTOS');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* se borró: se crea otra */ } }
  var f = DriveApp.createFolder('Fotos catálogo tienda');
  props.setProperty('CARPETA_FOTOS', f.getId());
  return f;
}

/* ======================= códigos ======================= */
function checkChar(body) {
  var s = 0;
  for (var i = 0; i < body.length; i++) s += (CODE_CHARS.indexOf(body.charAt(i)) + 1) * (i + 3);
  return CODE_CHARS.charAt(s % 31);   // 31 es primo: detecta 99,8% de letras cambiadas o invertidas
}
// Acepta minúsculas, espacios y guiones. El dígito verificador detecta cualquier letra mal copiada.
function normalizarCodigo(c) {
  return String(c || '').toUpperCase().replace(/[\s\-]/g, '');
}
function codigoValido(c) {
  c = normalizarCodigo(c);
  if (!/^[23456789A-HJ-NP-Z]{7}$/.test(c)) return false;
  return checkChar(c.slice(0, 6)) === c.charAt(6);
}

/* ======================= clics (públicos) ======================= */
function txt(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max || 200); }

// Un texto que empieza con = + - @ se interpreta como FÓRMULA al escribirlo en la planilla (por ejemplo =IMPORTDATA(...)
// podría sacar datos). Como los clics son públicos, TODO texto que llega a una celda pasa por acá: el apóstrofe lo deja como texto.
function celda_(v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }
function fila_(arr) { return arr.map(celda_); }

function registrarClic(b) {
  var code = normalizarCodigo(b.codigo);
  if (!codigoValido(code)) return { success: false, message: 'codigo-invalido' };
  if (b.ip) { // máximo 60 clics por IP cada 10 minutos (una IP puede ser de muchos clientes: por eso es holgado)
    var cc = CacheService.getScriptCache(), k = 'rl_' + hex_(String(b.ip)).slice(0, 24), n = Number(cc.get(k) || 0);
    if (n >= 60) return { success: false, message: 'demasiados-clics' };
    cc.put(k, String(n + 1), 600);
  }
  var o = (b.origen && typeof b.origen === 'object') ? b.origen : {};
  var c = config();
  var items = limpiarItems(b.items);
  if (!items.length && b.productoId) items = limpiarItems([{ productoId: b.productoId, producto: b.producto, color: b.color, talle: b.talle, cantidad: b.cantidad, precio: b.precio }]);
  if (!items.length) return { success: false, message: 'pedido-vacio' };
  var i0 = items[0] || {}, unidades = items.reduce(function (s, x) { return s + x.cantidad; }, 0) || 1;
  var fila = fila_([
    new Date(), code, txt(b.uuid, 40), i0.productoId || '', txt(resumenItems(items), 90),
    i0.color || '', i0.talle || '', unidades, i0.precio || 0, Number(b.valor) || 0,
    txt(b.fbc, 300), txt(b.fbp, 120), txt(b.ip, 60), txt(b.ua, 400), txt(b.pagina, 500),
    txt(o.fbclid, 300), txt(o.utm_source, 80), txt(o.utm_campaign, 120), txt(o.utm_content, 120),
    txt(o.ad_id, 40), txt(o.adset_id, 40), txt(o.campaign_id, 40), txt(b.leadEventId, 60), '', 'pendiente', JSON.stringify(items)
  ]);
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  var sh = hoja('Clics'), row;
  try {
    // un mismo código no se registra dos veces (reintentos del navegador)
    var hit = sh.getRange(2, 2, Math.max(1, sh.getLastRow() - 1), 1).createTextFinder(code).matchEntireCell(true).findNext();
    if (hit) return { success: true, duplicado: true };
    sh.appendRow(fila); row = sh.getLastRow();
  } finally { lock.releaseLock(); }

  if (si(c.enviarLeadCAPI) && b.leadEventId) {
    var ev = {
      event_name: 'Lead', event_time: Math.floor(Date.now() / 1000), event_id: txt(b.leadEventId, 60),
      action_source: 'website', event_source_url: txt(b.pagina, 500),
      user_data: userData({ fbc: b.fbc, fbp: b.fbp, ip: b.ip, ua: b.ua, uuid: b.uuid }),
      custom_data: { currency: 'ARS', value: Number(b.valor) || 0, content_type: 'product',
                     content_ids: items.map(function (x) { return x.productoId; }),
                     contents: items.map(function (x) { return { id: x.productoId, quantity: x.cantidad, item_price: x.precio }; }) }
    };
    var r = enviarCAPI([ev], c);
    sh.getRange(row, H.Clics.indexOf('capi_lead') + 1).setValue(r.ok ? 'ok' : ('error: ' + r.msg).slice(0, 200));
  }
  return { success: true };
}

function limpiarItems(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 30).filter(function (x) { return x && x.productoId; }).map(function (x) {
    var o = { productoId: txt(x.productoId, 40), producto: txt(x.producto, 80), color: txt(x.color, 40), talle: txt(x.talle, 8),
              cantidad: Math.max(1, Math.min(10, Math.floor(Number(x.cantidad) || 1))), precio: Math.max(0, Number(x.precio) || 0) };
    if (x.combo) o.combo = txt(x.combo, 80);   // la prenda viene de un combo: el precio ya es la parte que le toca del precio del combo
    return o;
  });
}
// Nombre corto del pedido: "Combo Verano +1" (los combos cuentan como una sola cosa)
function resumenItems(items, alternativo) {
  var nombres = [], vistos = {};
  items.forEach(function (x) { var n = x.combo || x.producto || ''; if (n && !vistos[n]) { vistos[n] = 1; nombres.push(n); } });
  if (!nombres.length) return alternativo || '';
  return nombres[0] + (nombres.length > 1 ? ' +' + (nombres.length - 1) : '');
}
function itemsDelClic(cl) {
  try { var it = limpiarItems(JSON.parse(cl.items || '[]')); if (it.length) return it; } catch (e) {}
  return cl.producto_id ? [{ productoId: cl.producto_id, producto: cl.producto, color: cl.color, talle: cl.talle, cantidad: Number(cl.cantidad) || 1, precio: Number(cl.precio) || 0 }] : [];
}

/* ======================= ventas (PWA) ======================= */
function buscarClicPorCodigo(code) {
  var sh = hoja('Clics');
  if (sh.getLastRow() < 2) return null;
  var hit = sh.getRange(2, 2, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
  if (!hit) return null;
  var row = hit.getRow(), v = sh.getRange(row, 1, 1, H.Clics.length).getValues()[0], o = { _row: row };
  H.Clics.forEach(function (h, i) { o[h] = v[i]; });
  return o;
}

function ventaExistente(code) {
  var sh = hoja('Ventas');
  if (!code || sh.getLastRow() < 2) return false;
  return !!sh.getRange(2, 2, sh.getLastRow() - 1, 1).createTextFinder(code).matchEntireCell(true).findNext();
}

function buscarCodigo(codigo) {
  var code = normalizarCodigo(codigo);
  if (!codigoValido(code)) return { success: false, message: 'codigo-invalido: revisá que esté bien copiado' };
  var cl = buscarClicPorCodigo(code);
  if (!cl) return { success: false, message: 'codigo-no-encontrado' };
  return {
    success: true, codigo: code, yaVendido: ventaExistente(code),
    clic: { fecha: cl.fecha, productoId: cl.producto_id, producto: cl.producto, color: cl.color, talle: cl.talle,
            cantidad: cl.cantidad, valor: cl.valor, campana: cl.utm_campaign, anuncio: cl.ad_id, estado: cl.estado,
            items: itemsDelClic(cl) }
  };
}

/**
 * Registra una venta y manda Purchase a Meta.
 * b = { codigo?, telefono, monto, descontarStock (default true),
 *       items?: [{ productoId, producto, color, talle, cantidad, precio, combo? }]  // lo que el cliente compró de verdad; si no viene, se usa el pedido del clic
 *       forzar?  // registrar aunque parezca una venta repetida (mismo teléfono y monto en 10 minutos)
 *       ciudad?  // opcional: aparece en los avisos de ventas recientes ("Alguien de Curuzú Cuatiá compró…")
 *       nota? }
 */
function registrarVenta(b) {
  var tel = normalizarTelefono(b.telefono);
  // acepta 24000, "24000", "24.000" o "$ 24.000,50"
  var monto = typeof b.monto === 'number' ? Math.round(b.monto)
    : Math.round(Number(String(b.monto || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
  if (!(monto > 0)) return { success: false, message: 'monto-invalido' };
  if (!tel) return { success: false, message: 'telefono-invalido: usá el número completo con característica' };

  var code = b.codigo ? normalizarCodigo(b.codigo) : '';
  if (code && !codigoValido(code)) return { success: false, message: 'codigo-invalido: revisá que esté bien copiado' };

  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var cl = null, items, filaVenta, eventId;
  try {
    if (code) {
      if (ventaExistente(code)) return { success: false, message: 'venta-ya-registrada para ese código' };
      cl = buscarClicPorCodigo(code);
      if (!cl) return { success: false, message: 'codigo-no-encontrado' };
    }
    if (!code && !b.forzar) { // sin código no hay otra forma de detectar un doble toque: mismo teléfono y monto en 10 minutos
      var ult = leer('Ventas').rows.slice(-30), hace10 = Date.now() - 600000;
      var rep = ult.some(function (r) { return r.fecha instanceof Date && r.fecha.getTime() > hace10 && String(r.telefono).replace(/\D/g, '') === tel && Math.round(Number(r.monto)) === monto; });
      if (rep) return { success: false, message: 'posible-duplicado' };
    }
    items = b.sinItems ? []   // la PWA quitó todas las prendas: se registra solo el monto
      : (Array.isArray(b.items) && b.items.length ? limpiarItems(b.items) : (cl ? itemsDelClic(cl) : []));

    // stock
    var stockRes = [];
    if (b.descontarStock !== false) {
      items.forEach(function (it) {
        if (it.productoId && it.color && it.talle) stockRes.push(cambiarStock(it.productoId, it.color, it.talle, -(Number(it.cantidad) || 1)));
      });
      limpiarCache();
    }

    eventId = code ? 'purchase_' + code : 'purchase_tel_' + sha256(tel).slice(0, 12) + '_' + Math.floor(Date.now() / 1000);
    var it0 = items[0] || {};
    var sh = hoja('Ventas');
    var nombreVenta = items.length ? resumenItems(items) : (cl ? String(cl.producto).replace(/\s\+\d+$/, '') : '');
    sh.appendRow(fila_([new Date(), code, "'" + tel, monto, it0.productoId || '', txt(nombreVenta, 90),
                  it0.combo ? '' : (it0.color || ''), it0.combo ? '' : (it0.talle || ''), items.reduce(function (s, x) { return s + (Number(x.cantidad) || 1); }, 0) || 1,
                  eventId, 'enviando', '', txt(b.nota, 200), txt(b.ciudad, 40), JSON.stringify(items)]));
    limpiarCache();   // así el aviso de la venta aparece en la landing
    filaVenta = sh.getLastRow();
    if (cl) hoja('Clics').getRange(cl._row, H.Clics.indexOf('estado') + 1).setValue('vendido');
  } finally { lock.releaseLock(); }

  // Purchase a Meta (fuera del lock: puede tardar)
  var c = config();
  var conClic = !!(cl && cl.user_agent);
  var ev = {
    event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: eventId,
    // Con clic usamos la fuente configurada (por defecto "website": la compra nace de una visita a la web).
    // Sin código no hay navegador asociado: se informa como "chat".
    action_source: conClic ? (c.capiFuenteCompra === 'chat' ? 'chat' : 'website') : 'chat',
    user_data: userData({ tel: tel, fbc: cl && cl.fbc, fbp: cl && cl.fbp, ip: cl && cl.ip, ua: cl && cl.user_agent, uuid: cl && cl.uuid }),
    custom_data: {
      currency: 'ARS', value: monto, order_id: code || eventId, content_type: 'product',
      content_ids: items.map(function (x) { return String(x.productoId || ''); }).filter(String),
      contents: items.filter(function (x) { return x.productoId; }).map(function (x) {
        var o = { id: String(x.productoId), quantity: Number(x.cantidad) || 1 }; if (x.precio > 0) o.item_price = x.precio; return o;
      })
    }
  };
  if (conClic && ev.action_source === 'website' && cl.pagina) ev.event_source_url = String(cl.pagina);
  var r = enviarCAPI([ev], c);
  var sh2 = hoja('Ventas');
  sh2.getRange(filaVenta, H.Ventas.indexOf('capi_estado') + 1, 1, 2).setValues([[r.ok ? 'ok' : 'error', String(r.msg).slice(0, 400)]]);

  return { success: true, eventId: eventId, capi: r, stock: stockRes, conClic: conClic, telefono: tel };
}

function ultimasVentas(n) {
  var rows = leer('Ventas').rows.slice(-Math.min(Number(n) || 30, 200)).reverse();
  return { success: true, ventas: rows.map(function (r) { delete r._row; return r; }) };
}
function ultimosClics(n) {
  var rows = leer('Clics').rows.slice(-Math.min(Number(n) || 30, 200)).reverse();
  return { success: true, clics: rows.map(function (r) {
    return { fecha: r.fecha, codigo: r.codigo, producto: r.producto, color: r.color, talle: r.talle, valor: r.valor,
             campana: r.utm_campaign, anuncio: r.ad_id, estado: r.estado, capi_lead: r.capi_lead };
  }) };
}

/* ======================= Meta: API de Conversiones ======================= */
function sha256(s) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// Celular argentino -> 549 + característica (sin 0) + número (sin 15). Devuelve '' si no tiene sentido.
function normalizarTelefono(t) {
  var d = String(t || '').replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.indexOf('549') === 0 && d.length === 13) return d;
  if (d.indexOf('54') === 0 && d.length === 12) return '549' + d.slice(2);
  if (d.indexOf('0') === 0) d = d.slice(1);
  // forma local con 15: característica (2 a 4 dígitos) + 15 + número, total 12 dígitos
  if (d.length === 12) { for (var k = 2; k <= 4; k++) if (d.substr(k, 2) === '15') { d = d.slice(0, k) + d.slice(k + 2); break; } }
  if (d.length === 10) return '549' + d;
  return '';
}

function userData(x) {
  var u = { country: [sha256('ar')] };
  if (x.tel) u.ph = [sha256(x.tel)];
  if (x.fbc) u.fbc = String(x.fbc);
  if (x.fbp) u.fbp = String(x.fbp);
  if (x.ip) u.client_ip_address = String(x.ip);
  if (x.ua) u.client_user_agent = String(x.ua);
  if (x.uuid) u.external_id = [sha256(String(x.uuid))];
  return u;
}

function enviarCAPI(eventos, c) {
  c = c || config();
  var token = PropertiesService.getScriptProperties().getProperty('CAPI_TOKEN');
  var ds = String(c.datasetId || c.pixelId || '').trim();
  if (!token || !/^\d{10,20}$/.test(ds)) return { ok: false, msg: 'capi-sin-configurar (falta CAPI_TOKEN o datasetId)' };
  var payload = { data: eventos, access_token: token };
  if (c.testEventCode) payload.test_event_code = c.testEventCode;
  try {
    var res = UrlFetchApp.fetch('https://graph.facebook.com/' + (c.graphVersion || 'v21.0') + '/' + ds + '/events', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var body = res.getContentText(), code = res.getResponseCode();
    return { ok: code === 200, msg: code + ' ' + body.slice(0, 300) };
  } catch (e) {
    return { ok: false, msg: 'red: ' + String(e && e.message || e).slice(0, 200) };
  }
}

/* ======================= instalación y pruebas ======================= */
function setup() {
  Object.keys(H).forEach(hoja);
  sincronizarEncabezados();
  var cfgSh = hoja('Config'), existentes = leer('Config').rows.map(function (r) { return String(r.clave).trim(); });
  CONFIG_DEFAULT.forEach(function (r) { if (existentes.indexOf(r[0]) === -1) cfgSh.appendRow(r); });
  cfgSh.getRange('A:A').setNumberFormat('@'); cfgSh.getRange('B:B').setNumberFormat('@');

  if (!leer('Productos').rows.length) cargarEjemplos();

  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('ADMIN_TOKEN'); // la clave vieja ya no sirve: ahora se entra con usuario y contraseña
  Logger.log(props.getProperty('ADMIN_HASH') ? 'Acceso del panel configurado (usuario: ' + props.getProperty('ADMIN_USER') + ').'
                                             : 'FALTA el acceso del panel: ejecutá crearAcceso() (archivo Acceso.gs).');
  Logger.log('Falta agregar CAPI_TOKEN en Propiedades del script: ' + (props.getProperty('CAPI_TOKEN') ? 'ya está' : 'SÍ, falta'));
  limpiarCache();
}

// Agrega a hojas ya existentes las columnas nuevas de esta versión (no toca datos).
function sincronizarEncabezados() {
  ['Productos', 'Clics', 'Ventas'].forEach(function (n) {
    var sh = hoja(n), lc = Math.max(1, sh.getLastColumn()), act = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
    H[n].forEach(function (h, i) { if (act[i] !== h && act.indexOf(h) === -1) sh.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
  });
}

// Productos de ejemplo. Borralos desde la PWA o directamente de las hojas Productos y Variantes.
function cargarEjemplos() {
  [
    { id: 'oversize-boxy', nombre: 'Oversize Boxy', precio: 24000, descripcion: 'Corte amplio y hombro caído. Algodón peinado 24/1, no transparenta.',
      calce: 'Oversize', tela: '100% algodón peinado 24/1', guiaTexto: 'S:56x70 | M:59x72 | L:62x74 | XL:65x76', etiqueta: 'Más pedida', orden: 1,
      variantes: [{ color: 'Negro', hex: '#1E1E22', stock: { S: 4, M: 6, L: 2, XL: 0 } }, { color: 'Blanco', hex: '#F2F2EF', stock: { S: 3, M: 5, L: 5, XL: 1 } },
                  { color: 'Gris melange', hex: '#A3A6AD', stock: { S: 0, M: 3, L: 4, XL: 2 } }, { color: 'Verde oliva', hex: '#5E6638', stock: { S: 2, M: 0, L: 3, XL: 0 } }] },
    { id: 'clasica-regular', nombre: 'Clásica Regular', precio: 19000, descripcion: 'La remera de todos los días. Calce al cuerpo sin ajustar.',
      calce: 'Regular', tela: '100% algodón peinado 24/1', guiaTexto: 'S:48x68 | M:51x70 | L:54x72 | XL:57x74 | XXL:60x76', orden: 2,
      variantes: [{ color: 'Blanco', hex: '#F2F2EF', stock: { S: 5, M: 8, L: 6, XL: 3, XXL: 1 } }, { color: 'Negro', hex: '#1E1E22', stock: { S: 4, M: 7, L: 5, XL: 2, XXL: 0 } },
                  { color: 'Azul marino', hex: '#22304F', stock: { S: 2, M: 3, L: 3, XL: 1, XXL: 1 } }] },
    { id: 'oversize-lavada', nombre: 'Oversize Lavada', precio: 26000, descripcion: 'Teñido con lavado a la piedra: cada una sale con un tono un poco distinto.',
      calce: 'Oversize', tela: '100% algodón 20/1, más gruesa', guiaTexto: 'S:57x70 | M:60x72 | L:63x74 | XL:66x76', etiqueta: 'Nueva', orden: 3,
      variantes: [{ color: 'Gris lavado', hex: '#6F7073', stock: { S: 1, M: 3, L: 2, XL: 1 } }, { color: 'Marrón lavado', hex: '#6E5848', stock: { S: 0, M: 2, L: 1, XL: 0 } }] }
    ,{ id: 'short-de-bano', nombre: 'Short de baño', categoria: 'Shorts', precio: 18000, descripcion: 'Secado rápido, con malla interior y bolsillo con cierre.',
      calce: 'Regular', tela: 'Poliéster microfibra', guiaTexto: 'S:76x44 | M:80x46 | L:84x48 | XL:88x50', guiaCols: ['Cintura', 'Largo'], orden: 4,
      variantes: [{ color: 'Azul', hex: '#1F3A6B', stock: { S: 3, M: 5, L: 4, XL: 2 } }, { color: 'Negro', hex: '#1E1E22', stock: { S: 2, M: 4, L: 3, XL: 1 } }] },
    { id: 'combo-verano', nombre: 'Combo Verano', tipo: 'combo', precio: 33000, descripcion: 'Una remera Clásica y un short de baño. Elegís color y talle de cada uno.',
      componentes: ['clasica-regular', 'short-de-bano'], etiqueta: 'Combo', orden: 5 }
  ].map(function (x) { x.categoria = x.categoria || (x.tipo === 'combo' ? '' : 'Remeras'); return x; }).forEach(guardarProducto);
}

// Ejecutalo con testEventCode cargado en Config para ver el evento en "Probar eventos" de Meta.
/* ======================= administración: secretos y diagnóstico ======================= */
// El token de Meta se guarda en Propiedades del script. Nunca se devuelve: solo se informa si está cargado.
function setSecreto(nombre, valor) {
  if (nombre !== 'CAPI_TOKEN') throw new Error('secreto-no-permitido');
  var v = String(valor || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (!v) { props.deleteProperty(nombre); return { success: true, cargado: false }; }
  if (!/^[A-Za-z0-9]{40,400}$/.test(v)) throw new Error('token-invalido: copialo completo, sin espacios');
  props.setProperty(nombre, v);
  return { success: true, cargado: true };
}

// Revisa de punta a punta que el tracking esté llegando bien. Lo usa la pantalla "Tracking" de la PWA.
function diagnostico() {
  var c = config(), props = PropertiesService.getScriptProperties();
  var clics = leer('Clics').rows.slice(-50), ventas = leer('Ventas').rows.slice(-20);
  function pct(f) { return clics.length ? Math.round(clics.filter(f).length * 100 / clics.length) : null; }
  var leadOk = clics.filter(function (r) { return r.capi_lead === 'ok'; }).length;
  var leadErr = clics.filter(function (r) { return String(r.capi_lead).indexOf('error') === 0; });
  var ventasOk = ventas.filter(function (r) { return r.capi_estado === 'ok'; }).length;
  var ventasErr = ventas.filter(function (r) { return r.capi_estado === 'error'; });
  var ultimo = clics[clics.length - 1];
  return {
    success: true,
    config: {
      numero: /^549\d{10}$/.test(c.numero || ''), pixelId: /^\d{10,20}$/.test(c.pixelId || ''),
      datasetId: /^\d{10,20}$/.test(c.datasetId || c.pixelId || ''), capiToken: !!props.getProperty('CAPI_TOKEN'),
      testEventCode: c.testEventCode || '', enviarLeadCAPI: si(c.enviarLeadCAPI), graphVersion: c.graphVersion || 'v25.0',
      mismoPixelYDataset: !c.datasetId || c.datasetId === c.pixelId
    },
    clics: {
      total: clics.length,
      conFbclid: pct(function (r) { return !!r.fbclid; }), conFbc: pct(function (r) { return !!r.fbc; }),
      conFbp: pct(function (r) { return !!r.fbp; }), conIp: pct(function (r) { return !!r.ip; }),
      conUa: pct(function (r) { return !!r.user_agent; }),
      leadOk: leadOk, leadError: leadErr.length,
      ultimoErrorLead: leadErr.length ? String(leadErr[leadErr.length - 1].capi_lead) : '',
      ultimo: ultimo ? { fecha: ultimo.fecha, codigo: ultimo.codigo, fbc: !!ultimo.fbc, fbp: !!ultimo.fbp, ip: !!ultimo.ip, capi: ultimo.capi_lead } : null
    },
    ventas: {
      total: ventas.length, ok: ventasOk, error: ventasErr.length,
      ultimoError: ventasErr.length ? String(ventasErr[ventasErr.length - 1].capi_respuesta) : '',
      sinCodigo: ventas.filter(function (r) { return !r.codigo; }).length
    }
  };
}

// Evento de prueba desde la PWA. Exige testEventCode para no ensuciar los datos reales de la campaña.
function probarEvento() {
  var c = config();
  if (!c.testEventCode) return { success: false, message: 'Cargá primero el código de prueba (testEventCode) del Administrador de eventos' };
  var r = enviarCAPI([{
    event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: 'prueba_' + Date.now(), action_source: 'website',
    event_source_url: 'https://prueba.invalid/', user_data: userData({ tel: '5493774000000', ua: 'Mozilla/5.0 (prueba PWA)', ip: '181.0.0.1' }),
    custom_data: { currency: 'ARS', value: 1 }
  }], c);
  return { success: r.ok, message: r.msg };
}

function probarCAPI() {
  var r = enviarCAPI([{
    event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: 'prueba_' + Date.now(), action_source: 'chat',
    user_data: userData({ tel: '5493774000000' }), custom_data: { currency: 'ARS', value: 1 }
  }]);
  Logger.log(JSON.stringify(r));
}

function probarCodigo() { // control rápido del dígito verificador
  var b = 'AJ2422'; Logger.log(b + checkChar(b) + ' -> ' + codigoValido(b + checkChar(b)));
}
