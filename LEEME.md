# Landing de remeras → WhatsApp con código por clic

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `index.html` | La landing. Catálogo, color, talle con stock, tabla de medidas, código único por clic, Pixel. |
| `functions/catalogo.js` | Sirve el catálogo desde el borde de Netlify (rápido, con caché de 30 s). |
| `functions/clic.js` | Recibe cada clic, le agrega la IP real del cliente y lo manda al Apps Script. |
| `apps-script/Code.gs` | Backend en Google Sheets: catálogo, stock, clics, ventas, API de Conversiones y las acciones que va a usar la PWA. |
| `netlify.toml` | Configuración de Netlify. |

## El panel (PWA) — `/admin/`

Abrí `https://TU-SITIO.netlify.app/admin/` en el celular → menú del navegador → "Agregar a la pantalla principal".
Se entra con usuario y contraseña. La sesión dura 30 días en ese dispositivo. La URL del Apps Script viene cargada; se cambia en "Conexión", dentro del ingreso.

| Pestaña | Qué hacés |
|---|---|
| Ventas | Pegás el mensaje del cliente (o solo el código), se carga el pedido solo, ponés teléfono, monto y ciudad → se registra la venta, se descuenta el stock y se manda la compra a Meta con los datos del clic del cliente. |
| Productos | Crear, editar, ocultar o borrar. Nombre, precio, precio anterior (descuento), talles y medidas, colores, fotos (se achican solas antes de subir) y stock por talle. |
| Tracking | Revisa todo el circuito: número, Pixel, token, IP/fbc/fbp de los clics, Leads y compras que Meta aceptó o rechazó, con el error exacto. Evento de prueba. |
| Ajustes | WhatsApp, Pixel, conjunto de datos, token de Meta, código de prueba, todos los textos de la tienda, avisos de ventas y reseñas. |

Después de la instalación inicial no hace falta tocar la planilla, Netlify ni el Apps Script para nada del día a día.
En Ajustes también: abrir la planilla, cambiar usuario y contraseña, y cerrar sesión (en este dispositivo o en todos).

## Seguridad

- La contraseña no está en ningún archivo de la tienda ni del panel: se verifica en el Apps Script y allí solo queda un hash con sal.
- Con usuario y contraseña correctos se entrega una sesión al azar (64 caracteres, 30 días). Cada acción de administración la exige.
- 8 intentos fallidos bloquean el ingreso 15 minutos. Cambiar la contraseña cierra las demás sesiones.
- Los datos privados (teléfonos, ventas, clics, token de Meta) solo salen con sesión. Lo público es el catálogo y el aviso de ventas sin nombres ni teléfonos.
- **La planilla de Google tiene que estar en "Restringido"** (Compartir → Acceso general). Si cualquiera con el enlace puede verla, ve teléfonos y ventas sin pasar por el panel.
- Límite de 60 clics por IP cada 10 minutos para que nadie llene la planilla.

## Puesta en marcha (en este orden)

1. **Planilla + Apps Script.** Planilla → Extensiones → Apps Script → pegá `Code.gs` → ejecutá `setup()`.
   Después creá un archivo nuevo con el contenido de `Acceso.gs` (te lo paso aparte, NO va al repositorio), ejecutá `crearAcceso()` y **borrá ese archivo**.
   Si ya tenías una versión anterior: ejecutá `setup()` y `crearAcceso()` igual, y en el paso 2 hacé una versión nueva de la implementación (la URL no cambia).
2. **Publicar el Apps Script.** Implementar → Aplicación web → Ejecutar como: Yo · Acceso: Cualquier usuario. Copiá la URL `/exec`.
   Para actualizar una implementación existente: Implementar → Gestionar implementaciones → lápiz → Versión: **Nueva versión** → Implementar. Sin eso, el código nuevo no se aplica.
3. **Netlify.** Subí esta carpeta. En Site configuration → Environment variables: `APPS_SCRIPT_URL` = la URL `/exec`. Volvé a desplegar.
4. **Respaldo en la landing.** Pegá la misma URL en `APPS_SCRIPT_URL` dentro de `index.html` (bloque `window.TIENDA`). Mientras esté vacía y Netlify no responda, la página muestra el catálogo de ejemplo.
5. **Panel.** Entrá a `/admin/`, conectalo y en Ajustes cargá WhatsApp, Pixel, token de Meta y textos.
6. **Prueba de punta a punta.** En Ajustes poné el código de prueba de Meta, hacé un pedido real desde la tienda, registralo en Ventas y miralo en "Probar eventos". La pestaña Tracking te dice si algo falla. Después **borrá el código de prueba**.

## URL de los anuncios

Usá los parámetros dinámicos de Meta para saber qué anuncio trajo cada pedido:

```
https://TU-SITIO.netlify.app/?utm_source=meta&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}
```

Meta agrega el `fbclid` solo.

## Cómo se editan los productos (hasta que esté la PWA)

Directamente en la planilla. La landing toma los cambios en un minuto como máximo.

- **Productos:** `id`, `nombre`, `precio`, `precio_antes` (solo si el descuento es real), `descripcion`, `calce`, `tela`,
  `guia_talles` con formato `S:56x70 | M:59x72` (ancho de pecho x largo, en cm), `etiqueta`, `activo` (si/no), `orden`.
- **Variantes:** una fila por color. `imagenes`: URLs https separadas por `|`. Las columnas desde `S` en adelante son talles:
  número = stock, `0` = agotado, vacío = ese talle no existe. Para agregar un talle nuevo, agregá la columna.
- **Reseñas:** solo reseñas reales, con `activo` = si. Si no hay ninguna, la sección no aparece.
- **Quitar los ejemplos:** borrá sus filas en Productos y en Variantes (o poné `activo` = no).

## Descuentos

En la hoja Productos: `precio` = precio nuevo, `precio_antes` = precio anterior. Si `precio_antes` es mayor,
la landing muestra el precio tachado, el % OFF en la etiqueta, "Ahorrás $X" en la ficha y el ahorro total en el pedido.
Para quitar el descuento, borrá `precio_antes`. Usá precios anteriores reales: un "antes" inflado es publicidad engañosa.

## Pedido con varias remeras

"Agregar al pedido y seguir viendo" suma la remera a una barra fija abajo. "Pedir por WhatsApp" manda todo junto en un
solo mensaje con un solo código. El clic guarda el pedido completo (columna `items` de Clics) y `registrarVenta`
descuenta el stock de cada remera y manda un solo Purchase con todos los productos.

## Avisos de ventas recientes

Salen de la hoja **Ventas**: cada venta que registrás aparece abajo como "Alguien de Curuzú Cuatiá compró Oversize Boxy
en Negro · hace 2 horas". La ciudad es opcional (`ciudad` al registrar la venta). Nunca muestra nombre ni teléfono.
Config: `mostrarVentasRecientes` (si/no) y `ventasRecientesDias` (antigüedad máxima, 14 por defecto).
Si todavía no hay ventas, no aparece ningún aviso.

## El código

7 caracteres (ej. `TL43BGY`): 6 al azar + 1 verificador. Uno nuevo por cada clic en "Pedir por WhatsApp".
El verificador hace que la PWA rechace un código mal copiado antes de mandar nada a Meta.

## Lo que la PWA va a usar (POST al Apps Script con la sesión)

`adminCatalogo`, `guardarProducto`, `borrarProducto`, `ajustarStock`, `setConfig`, `subirImagen`,
`buscarCodigo`, `registrarVenta`, `ultimasVentas`, `ultimosClics`, `guardarResenas`. Todas con `token` = sesión (se obtiene con la acción `login`).

`registrarVenta` recibe `{ codigo?, telefono, monto }`: busca el clic, descuenta el stock, guarda la venta y manda
`Purchase` con la IP, navegador, fbc y fbp **del clic del cliente**, el teléfono hasheado y `event_id = purchase_CODIGO`.
Sin código igual registra la venta, solo con el teléfono.

## Decisión pendiente: `capiFuenteCompra`

Por defecto el Purchase con código sale como `website`, porque la compra nace de una visita a la landing y así cuenta
para la campaña. Lo estrictamente literal sería `chat`, pero no está confirmado que Meta use esos eventos para optimizar
una campaña de sitio web. Probalo con las primeras ventas en el Administrador de eventos antes de cambiarlo.


## Novedades (categorías, combos, ventas, ajustes)

**Al actualizar Code.gs**: pegá el nuevo código, ejecutá `setup()` una vez (agrega las columnas nuevas sin borrar nada) y creá una *nueva versión* de la implementación. No subas nunca `Acceso.gs` a GitHub.

- **Categorías**: cada producto tiene `categoria`; la landing muestra filtros arriba. Cada producto puede tener sus propias etiquetas de guía de talles (ej. shorts: cintura/largo).
- **Combos**: en Productos → "Nuevo combo" elegís 2–4 espacios (producto o categoría) y el precio del combo. El cliente elige talle y color de cada prenda y ve "antes" = suma real de las prendas elegidas y "ahora" = precio combo. El descuento es real: si el combo no es más barato que la suma, no se muestra tachado. Cuidá el margen: costo remera $9.000 + short $8.800 + publicidad.
- **Ventas**: al pegar el mensaje del cliente se cargan los ítems; podés cambiar cantidad/talle/color, quitarlos o poner solo el **monto** cobrado. Evita registrar dos veces el mismo código.
- **Ajustes**: cada sección (Tienda, Meta, Textos…) tiene su propio botón Guardar; guardar una no toca las demás.
- **Reseñas**: usá "Pedir reseña" tras cada venta para juntar reseñas reales. No se cargan reseñas ni avisos de compra inventados (Meta puede cerrar la cuenta publicitaria y es publicidad engañosa). El aviso de "compró recientemente" usa ventas reales.
- **Seguridad**: protección contra fórmulas en la planilla, límite de clics por IP, sesiones con hash. Dejá la planilla en acceso *Restringido* y cambiá la contraseña inicial desde el panel.
