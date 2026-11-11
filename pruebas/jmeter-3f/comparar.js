#!/usr/bin/env node
/**
 * BusGlow - Comparativa de las pruebas de carga (250, 500 y 1000 usuarios)
 *
 * Lee los resultados .jtl de JMeter (formato CSV, el que genera ejecutar_pruebas.bat)
 * y crea comparativa.html con tablas, gráficos y conclusiones frente al RNF de 3 s.
 *
 * Uso:
 *   node comparar.js <carpeta_250> <carpeta_500> <carpeta_1000> [--salida comparativa.html]
 *   (cada carpeta contiene resultados.jtl; el número de usuarios se toma del nombre: carga_250, etc.)
 *
 * Sin dependencias: solo Node.js.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RNF_MS = 3000;           // RNF de rendimiento: responder en máximo 3 s
const ERROR_MAX_PCT = 1;       // tolerancia de errores para considerar "cumple"
const FUNCIONES = [
    { clave: 'F1', nombre: 'Inicio de sesión' },
    { clave: 'F2', nombre: 'Búsqueda de viajes' },
    { clave: 'F3', nombre: 'Compra de pasaje' }
];

/* ------------------------------------------------------------------ lectura */

/** Divide una línea CSV respetando comillas. */
function dividirCsv(linea) {
    const campos = [];
    let actual = '', comillas = false;
    for (let i = 0; i < linea.length; i++) {
        const ch = linea[i];
        if (comillas) {
            if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
            else if (ch === '"') comillas = false;
            else actual += ch;
        } else if (ch === '"') comillas = true;
        else if (ch === ',') { campos.push(actual); actual = ''; }
        else actual += ch;
    }
    campos.push(actual);
    return campos;
}

const percentil = (ordenados, p) => {
    if (!ordenados.length) return 0;
    const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
    return ordenados[i];
};

/** Lee un .jtl y devuelve estadísticas por funcionalidad (transacciones F1/F2/F3) y por petición. */
async function leerJtl(archivo) {
    const grupos = new Map();      // etiqueta -> { tiempos[], errores, inicio, fin, codigos }
    let col = null, tMin = Infinity, tMax = 0, totalPeticiones = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(archivo, 'utf8'), crlfDelay: Infinity });
    for await (const linea of rl) {
        if (!linea.trim()) continue;
        const c = dividirCsv(linea);
        if (!col) { col = Object.fromEntries(c.map((n, i) => [n, i])); continue; }
        const etiqueta = c[col.label];
        if (!/^F[123]/.test(etiqueta)) continue;                 // ignora setUp y otros
        const ts = Number(c[col.timeStamp]), ms = Number(c[col.elapsed]);
        const ok = c[col.success] === 'true';
        let g = grupos.get(etiqueta);
        if (!g) { g = { tiempos: [], errores: 0, inicio: Infinity, fin: 0, codigos: {} }; grupos.set(etiqueta, g); }
        g.tiempos.push(ms);
        if (!ok) g.errores++;
        const cod = c[col.responseCode] || '—';
        g.codigos[cod] = (g.codigos[cod] || 0) + 1;
        g.inicio = Math.min(g.inicio, ts); g.fin = Math.max(g.fin, ts + ms);
        if (/^F[123]\.\d/.test(etiqueta)) { totalPeticiones++; tMin = Math.min(tMin, ts); tMax = Math.max(tMax, ts + ms); }
    }
    if (!col) throw new Error(`${archivo} está vacío o no es un .jtl en formato CSV.`);

    const resumen = etiqueta => {
        const g = grupos.get(etiqueta);
        const t = g.tiempos.sort((a, b) => a - b);
        const seg = Math.max(1, (g.fin - g.inicio) / 1000);
        return {
            etiqueta, muestras: t.length, promedio: Math.round(t.reduce((s, x) => s + x, 0) / t.length),
            p90: percentil(t, 90), p95: percentil(t, 95), max: t[t.length - 1],
            errorPct: Math.round(1000 * g.errores / t.length) / 10, porSegundo: Math.round(10 * t.length / seg) / 10, codigos: g.codigos
        };
    };
    const etiquetas = [...grupos.keys()].sort();
    return {
        funciones: Object.fromEntries(FUNCIONES.map(f => {
            const et = etiquetas.find(e => e.startsWith(`${f.clave} `));
            return [f.clave, et ? resumen(et) : null];
        })),
        peticiones: etiquetas.filter(e => /^F[123]\.\d/.test(e)).map(resumen),
        peticionesPorSegundo: Math.round(10 * totalPeticiones / Math.max(1, (tMax - tMin) / 1000)) / 10
    };
}

/* ------------------------------------------------------------------ html */

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtMs = ms => ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
const fmtN = n => n.toLocaleString('es-PE');

/** Gráfico de barras agrupadas en SVG: un grupo por funcionalidad, una barra por carga. */
function barrasAgrupadas({ titulo, subtitulo, grupos, cargas, valor, formato, referencia, unidad }) {
    const W = 760, H = 300, m = { t: 20, r: 20, b: 46, l: 64 };
    const ancho = W - m.l - m.r, alto = H - m.t - m.b;
    const valores = grupos.flatMap(g => cargas.map(c => valor(g, c) ?? 0));
    let tope = Math.max(...valores, referencia || 0) * 1.15 || 1;
    const paso = Math.pow(10, Math.floor(Math.log10(tope / 4)));
    const tick = [1, 2, 2.5, 5, 10].map(k => k * paso).find(k => tope / k <= 5) || paso * 10;
    tope = Math.ceil(tope / tick) * tick;
    const y = v => m.t + alto - (v / tope) * alto;
    const anchoGrupo = ancho / grupos.length;
    const barra = Math.min(46, (anchoGrupo - 40) / cargas.length - 2);
    let svg = '';
    for (let v = 0; v <= tope + 1e-9; v += tick) {
        svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>` +
               `<text class="eje" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(formato(v, true))}</text>`;
    }
    grupos.forEach((g, gi) => {
        const x0 = m.l + gi * anchoGrupo + (anchoGrupo - cargas.length * (barra + 2)) / 2;
        cargas.forEach((c, ci) => {
            const v = valor(g, c);
            if (v == null) return;
            const x = x0 + ci * (barra + 2), h = Math.max(1, (v / tope) * alto), yy = m.t + alto - h, r = Math.min(4, barra / 2, h);
            // barra con extremo superior redondeado, anclada a la línea base
            const d = `M${x},${m.t + alto} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barra - r} Q${x + barra},${yy} ${x + barra},${yy + r} V${m.t + alto} Z`;
            svg += `<path class="s${ci + 1} barra" d="${d}" data-tip="${esc(`${g.nombre} · ${c.usuarios} usuarios: ${formato(v)}`)}"/>`;
            if (barra >= 22) svg += `<text class="dato" x="${x + barra / 2}" y="${yy - 5}" text-anchor="middle">${esc(formato(v, true))}</text>`;
        });
        svg += `<text class="cat" x="${m.l + gi * anchoGrupo + anchoGrupo / 2}" y="${H - 18}" text-anchor="middle">${esc(g.nombre)}</text>`;
    });
    if (referencia) {
        svg += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y(referencia)}" y2="${y(referencia)}"/>` +
               `<text class="ref-txt" x="${m.l + 6}" y="${y(referencia) - 6}" text-anchor="start">RNF: máximo ${esc(formato(referencia))}</text>`;
    }
    svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + alto}" y2="${m.t + alto}"/>`;
    const leyenda = cargas.map((c, i) => `<span><i class="s${i + 1}"></i>${c.usuarios} usuarios</span>`).join('');
    return `<figure class="tarjeta"><figcaption><h3>${esc(titulo)}</h3><p>${esc(subtitulo)}</p></figcaption>
        <div class="leyenda">${leyenda}</div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">${svg}</svg>
        <p class="unidad">${esc(unidad)}</p></figure>`;
}

function conclusiones(cargas) {
    const lineas = [];
    for (const f of FUNCIONES) {
        const cumple = cargas.filter(c => { const r = c.datos.funciones[f.clave]; return r && r.p90 <= RNF_MS && r.errorPct <= ERROR_MAX_PCT; });
        const capacidad = cumple.length ? Math.max(...cumple.map(c => c.usuarios)) : null;
        const peor = cargas[cargas.length - 1].datos.funciones[f.clave];
        lineas.push({ f, capacidad, peor });
    }
    return lineas;
}

/** Recomendaciones según lo que muestran los datos. */
function recomendaciones(cargas) {
    const recs = [];
    const ultima = cargas[cargas.length - 1], primera = cargas[0];
    const f = (c, k) => c.datos.funciones[k] || { p90: 0, errorPct: 0, promedio: 0 };
    const p90 = k => f(ultima, k).p90;
    const peor = FUNCIONES.map(x => ({ ...x, p90: p90(x.clave) })).sort((a, b) => b.p90 - a.p90)[0];

    if (f(ultima, 'F1').p90 > RNF_MS || peor.clave === 'F1') {
        recs.push(['Inicio de sesión: cifrado que bloquea el servidor',
            'El login es la funcionalidad que más se degrada. La contraseña se verifica con crypto.scryptSync, que es síncrono: mientras se calcula, el servidor no atiende a nadie más, y eso también retrasa las búsquedas y las compras. Cambiar a crypto.scrypt (asíncrono) en src/utils/security.js.']);
    }
    if (f(ultima, 'F2').p90 > RNF_MS || f(ultima, 'F2').p90 > 3 * Math.max(1, f(primera, 'F2').p90)) {
        recs.push(['Búsqueda: quitar la escritura de cada consulta',
            'Cada búsqueda y cada mapa de asientos ejecuta liberarReservasExpiradas() (un UPDATE). Con cientos de usuarios esto bloquea las tablas que usa la compra. Dejar esa limpieza en la tarea programada y al reservar; usar una consulta más liviana para la búsqueda pública y guardar en memoria ciudades y rutas populares.']);
    }
    if (f(ultima, 'F3').p90 > RNF_MS || f(ultima, 'F3').errorPct > ERROR_MAX_PCT) {
        recs.push(['Compra: transacciones más cortas',
            'La compra hace varias escrituras en una transacción (reserva, pasajeros, asientos, pago, boletos). Revisar en SQL Server los bloqueos (Monitor de actividad) y mantener las transacciones lo más cortas posible. Los 409 no son errores: son la protección contra la doble venta funcionando.']);
    }
    const crece = cargas.some(c => FUNCIONES.some(x => f(c, x.clave).errorPct > 5));
    if (crece) {
        recs.push(['Errores con carga alta: conexiones y procesos',
            'Hay más de 5 % de errores en alguna carga. Revisar jmeter.log y la consola de Node: si son tiempos de espera, subir DB_POOL_MAX (por ejemplo 30-50) en .env, y ejecutar Node en varios procesos (cluster o PM2) para usar todos los núcleos del CPU.']);
    }
    recs.push(['Interpretar con cuidado el entorno de prueba',
        'JMeter, Node.js y SQL Server Express corrieron en la misma PC, y SQL Server Express usa como máximo 4 núcleos y unos 1,4 GB de memoria. Los resultados son una cota inferior: en un servidor dedicado el sistema rendiría más. Para mediciones finales, ejecutar JMeter desde otra computadora.']);
    recs.push(['Metodología',
        'Repetir cada carga al menos 2 veces y reportar la mediana; reiniciar la base (npm run db:init) entre corridas para que todas partan de los mismos datos, y registrar CPU y memoria del servidor durante la prueba.']);
    return recs;
}

function html(cargas) {
    const grupos = FUNCIONES;
    const val = campo => (g, c) => (c.datos.funciones[g.clave] || {})[campo];
    const concl = conclusiones(cargas);
    const tabla = `<table><thead><tr><th>Funcionalidad</th><th class="n">Usuarios</th><th class="n">Muestras</th><th class="n">Promedio</th>
        <th class="n">Percentil 90</th><th class="n">Percentil 95</th><th class="n">Máximo</th><th class="n">% error</th><th class="n">Transacciones/s</th><th>RNF 3 s</th></tr></thead><tbody>
        ${grupos.map(g => cargas.map(c => {
            const r = c.datos.funciones[g.clave];
            if (!r) return `<tr><td>${esc(g.nombre)}</td><td class="n">${c.usuarios}</td><td colspan="8" class="muted">Sin datos</td></tr>`;
            const ok = r.p90 <= RNF_MS && r.errorPct <= ERROR_MAX_PCT;
            return `<tr><td>${esc(g.nombre)}</td><td class="n">${c.usuarios}</td><td class="n">${fmtN(r.muestras)}</td><td class="n">${fmtMs(r.promedio)}</td>
                <td class="n"><b>${fmtMs(r.p90)}</b></td><td class="n">${fmtMs(r.p95)}</td><td class="n">${fmtMs(r.max)}</td><td class="n">${r.errorPct} %</td>
                <td class="n">${r.porSegundo}</td><td><span class="estado ${ok ? 'ok' : 'mal'}">${ok ? '✔ Cumple' : '✖ No cumple'}</span></td></tr>`;
        }).join('')).join('')}</tbody></table>`;

    const detalle = cargas.map(c => `<details><summary>Detalle por petición · ${c.usuarios} usuarios</summary>
        <table><thead><tr><th>Petición</th><th class="n">Muestras</th><th class="n">Promedio</th><th class="n">Percentil 90</th><th class="n">Máximo</th><th class="n">% error</th><th>Códigos HTTP</th></tr></thead><tbody>
        ${c.datos.peticiones.map(p => `<tr><td>${esc(p.etiqueta)}</td><td class="n">${fmtN(p.muestras)}</td><td class="n">${fmtMs(p.promedio)}</td><td class="n">${fmtMs(p.p90)}</td>
            <td class="n">${fmtMs(p.max)}</td><td class="n">${p.errorPct} %</td><td class="muted">${esc(Object.entries(p.codigos).map(([k, v]) => `${k}: ${v}`).join(' · '))}</td></tr>`).join('')}
        </tbody></table></details>`).join('');

    const fmtSeg = (v, corto) => corto ? (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)} s` : `${Math.round(v)} ms`) : fmtMs(Math.round(v));
    const graficos = [
        barrasAgrupadas({ titulo: 'Percentil 90 del tiempo de respuesta', subtitulo: 'El 90 % de los usuarios esperó menos que esto. Debe quedar bajo la línea de 3 s.',
            grupos, cargas, valor: val('p90'), formato: fmtSeg, referencia: RNF_MS, unidad: 'Tiempo de la funcionalidad completa (transacción)' }),
        barrasAgrupadas({ titulo: 'Tiempo promedio de respuesta', subtitulo: 'Cómo crece la espera promedio al aumentar los usuarios.',
            grupos, cargas, valor: val('promedio'), formato: fmtSeg, unidad: 'Tiempo de la funcionalidad completa (transacción)' }),
        barrasAgrupadas({ titulo: 'Porcentaje de errores', subtitulo: 'Peticiones fallidas o sin respuesta. Los 409 de la compra no cuentan: son la protección contra la doble venta.',
            grupos, cargas, valor: val('errorPct'), formato: (v, c) => c ? `${Math.round(v * 10) / 10} %` : `${v} %`, unidad: '% de transacciones con error' }),
        barrasAgrupadas({ titulo: 'Transacciones completadas por segundo', subtitulo: 'Rendimiento (throughput): si deja de crecer con más usuarios, el sistema llegó a su límite.',
            grupos, cargas, valor: val('porSegundo'), formato: v => `${Math.round(v * 10) / 10}`, unidad: 'Transacciones por segundo' })
    ].join('');

    const resumenCapacidad = concl.map(x => `<div class="kpi"><span>${esc(x.f.nombre)}</span>
        <strong>${x.capacidad ? `${x.capacidad} usuarios` : 'Menos de ' + cargas[0].usuarios}</strong>
        <small>${x.capacidad ? 'máxima carga probada que cumple el RNF de 3 s' : 'no cumple el RNF en ninguna carga probada'}</small></div>`).join('');

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BusGlow · Comparativa de carga</title>
<style>
:root{color-scheme:light;--surface:#fcfcfb;--page:#f4f3f0;--text:#0b0b0b;--text2:#52514e;--muted:#898781;--grid:#e1e0d9;--card:#ffffff;
 --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--good:#0ca30c;--critical:#d03b3b}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--page:#121211;--text:#f0efec;--text2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--card:#1a1a19;
 --s1:#3987e5;--s2:#d95926;--s3:#199e70}}
*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:var(--page);color:var(--text)}
main{max-width:1100px;margin:auto;padding:28px 16px 60px}h1{margin:0 0 4px;font-size:26px}h2{margin:34px 0 12px;font-size:19px}
.sub{color:var(--text2);margin:0 0 20px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.kpi{background:var(--card);border-radius:12px;padding:16px;border:1px solid var(--grid)}.kpi span{color:var(--text2);font-size:13px}
.kpi strong{display:block;font-size:24px;margin:6px 0 2px}.kpi small{color:var(--muted);font-size:12px}
.graficos{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:14px}
.tarjeta{background:var(--card);border:1px solid var(--grid);border-radius:12px;margin:0;padding:16px}
figcaption h3{margin:0;font-size:15px}figcaption p{margin:4px 0 8px;color:var(--text2);font-size:12.5px}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.base{stroke:var(--muted);stroke-width:1}
.eje,.cat,.dato,.ref-txt{fill:var(--text2);font-size:12px}.cat{fill:var(--text);font-size:13px}.dato{font-size:11px}
.ref{stroke:var(--text);stroke-width:1.5;stroke-dasharray:6 4}.ref-txt{fill:var(--text);font-weight:600}
.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}
.barra{stroke:var(--card);stroke-width:1}.barra:hover{opacity:.8}
.leyenda{display:flex;gap:16px;font-size:12.5px;color:var(--text2);margin-bottom:4px}.leyenda i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.unidad{color:var(--muted);font-size:11.5px;margin:4px 0 0}
table{width:100%;border-collapse:collapse;background:var(--card);font-size:13px;border-radius:12px;overflow:hidden}
th,td{padding:9px 10px;border-bottom:1px solid var(--grid);text-align:left}th{color:var(--text2);font-size:11.5px;text-transform:uppercase;letter-spacing:.3px}
.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}
.estado{font-weight:700;font-size:12px;white-space:nowrap}.estado.ok{color:var(--good)}.estado.mal{color:var(--critical)}
details{margin-top:10px}summary{cursor:pointer;color:var(--text2);margin-bottom:8px}
.rec{background:var(--card);border:1px solid var(--grid);border-radius:12px;padding:14px 16px;margin-bottom:10px}.rec b{display:block;margin-bottom:4px}.rec p{margin:0;color:var(--text2);font-size:13.5px;line-height:1.5}
#tip{position:fixed;pointer-events:none;background:var(--text);color:var(--surface);padding:6px 9px;border-radius:6px;font-size:12px;display:none;z-index:9}
@media (max-width:560px){.graficos{grid-template-columns:1fr}table{font-size:12px}}
</style></head><body><main>
<h1>BusGlow · Pruebas de carga</h1>
<p class="sub">Inicio de sesión, búsqueda de viajes y compra de pasaje con ${cargas.map(c => c.usuarios).join(', ')} usuarios simultáneos
(20 % login · 60 % búsqueda · 20 % compra). RNF de rendimiento: responder en máximo 3 segundos. Generado el ${new Date().toLocaleString('es-PE')}</p>
<h2>Capacidad por funcionalidad</h2><div class="kpis">${resumenCapacidad}</div>
<h2>Gráficos comparativos</h2><div class="graficos">${graficos}</div>
<h2>Resultados</h2>${tabla}${detalle}
<h2>Recomendaciones</h2>${recomendaciones(cargas).map(([t, d]) => `<div class="rec"><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join('')}
</main><div id="tip"></div>
<script>
const tip=document.getElementById('tip');
document.querySelectorAll('[data-tip]').forEach(el=>{
 el.addEventListener('mousemove',e=>{tip.textContent=el.dataset.tip;tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY-30)+'px'});
 el.addEventListener('mouseleave',()=>{tip.style.display='none'});});
</script></body></html>`;
}

/* ------------------------------------------------------------------ main */
(async () => {
    const args = process.argv.slice(2);
    let salida = 'comparativa.html';
    const i = args.indexOf('--salida');
    if (i >= 0) { salida = args[i + 1]; args.splice(i, 2); }
    if (!args.length) {
        console.error('Uso: node comparar.js <carpeta_carga_250> <carpeta_carga_500> <carpeta_carga_1000> [--salida comparativa.html]');
        process.exit(1);
    }
    const cargas = [];
    for (const a of args) {
        const archivo = fs.existsSync(a) && fs.statSync(a).isDirectory() ? path.join(a, 'resultados.jtl') : a;
        if (!fs.existsSync(archivo)) { console.error(`No existe ${archivo}`); continue; }
        const m = path.basename(path.dirname(path.resolve(archivo))).match(/(\d+)/) || path.basename(archivo).match(/(\d+)/);
        const usuarios = m ? Number(m[1]) : cargas.length + 1;
        console.log(`Leyendo ${archivo} (${usuarios} usuarios)...`);
        cargas.push({ usuarios, datos: await leerJtl(archivo) });
    }
    if (!cargas.length) process.exit(1);
    cargas.sort((a, b) => a.usuarios - b.usuarios);
    fs.writeFileSync(salida, html(cargas), 'utf8');

    console.log('\nFuncionalidad          Usuarios  Promedio  Percentil90  %Error  RNF 3s');
    for (const f of FUNCIONES) for (const c of cargas) {
        const r = c.datos.funciones[f.clave];
        if (!r) continue;
        console.log(`${f.nombre.padEnd(22)} ${String(c.usuarios).padStart(8)} ${fmtMs(r.promedio).padStart(9)} ${fmtMs(r.p90).padStart(12)} ${String(r.errorPct + ' %').padStart(7)}  ${r.p90 <= RNF_MS && r.errorPct <= ERROR_MAX_PCT ? 'Cumple' : 'No cumple'}`);
    }
    console.log(`\nComparativa con gráficos: ${path.resolve(salida)}`);
})().catch(err => { console.error(err.message); process.exit(1); });
