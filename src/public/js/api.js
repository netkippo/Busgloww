/* =====================================================================
   BusGlow - Cliente de la API (compartido por todas las páginas)
   ===================================================================== */
(function () {
    // Si la página se abre con Live Server o como archivo, se apunta al backend en el puerto 3000
    const mismoServidor = location.protocol.startsWith('http') && !['5500', '5501', '5502'].includes(location.port);
    const API_BASE = window.BUSGLOW_API || (mismoServidor ? '/api' : 'http://localhost:3000/api');

    const KEY_TOKEN = 'busglow_token';
    const KEY_USER = 'busglow_usuario';

    function safeGet(storage, key) {
        try { return storage.getItem(key); } catch { return null; }
    }
    function safeSet(storage, key, value) {
        try { value === null ? storage.removeItem(key) : storage.setItem(key, value); } catch { /* sin almacenamiento */ }
    }

    const session = {
        get token() { return safeGet(localStorage, KEY_TOKEN); },
        get user() {
            try { return JSON.parse(safeGet(localStorage, KEY_USER)) || null; } catch { return null; }
        },
        set(token, user) {
            safeSet(localStorage, KEY_TOKEN, token);
            safeSet(localStorage, KEY_USER, JSON.stringify(user));
        },
        updateUser(user) { safeSet(localStorage, KEY_USER, JSON.stringify(user)); },
        clear() {
            safeSet(localStorage, KEY_TOKEN, null);
            safeSet(localStorage, KEY_USER, null);
        },
        get isStaff() { const u = this.user; return !!u && ['ADMIN', 'EMPRESA', 'VENDEDOR'].includes(u.rol); }
    };

    /** Llamada a la API. Lanza un Error con .status y .message legibles. */
    async function api(path, { method = 'GET', body, auth = true } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;

        let res;
        try {
            res = await fetch(API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        } catch {
            const e = new Error('No se pudo conectar con el servidor. ¿Está ejecutándose el backend (npm start)?');
            e.status = 0;
            throw e;
        }

        let data = null;
        try { data = await res.json(); } catch { /* respuesta vacía */ }

        if (!res.ok) {
            if (res.status === 401 && auth && session.token) session.clear();
            const e = new Error((data && data.error) || `Error ${res.status}`);
            e.status = res.status;
            e.data = data;
            throw e;
        }
        return data;
    }

    /** Redirige al login si no hay sesión. Devuelve el usuario. */
    function requireLogin() {
        if (!session.token) {
            location.href = `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
            throw new Error('Sin sesión');
        }
        return session.user;
    }

    /* ---------- Formatos ---------- */
    const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const fmt = {
        money: n => `S/ ${Number(n || 0).toFixed(2)}`,
        fecha(iso) {           // 2026-09-15 -> 15 Sep 2026
            if (!iso) return '';
            const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
            return `${d} ${MESES[m - 1]} ${y}`;
        },
        fechaLarga(iso) {      // 2026-09-15 -> mar, 15 de septiembre de 2026
            if (!iso) return '';
            const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
            const dia = DIAS[new Date(y, m - 1, d).getDay()];
            return `${dia}, ${d} de ${MESES_LARGOS[m - 1]} de ${y}`;
        },
        hora12(hhmm) {         // 20:30 -> 08:30 PM
            if (!hhmm) return '';
            let [h, m] = hhmm.split(':').map(Number);
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
        },
        duracion(min) {
            if (!min && min !== 0) return '';
            const h = Math.floor(min / 60), m = min % 60;
            return `${h}h${m ? ` ${m}min` : ''}`;
        },
        hoy() {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },
        sumarDias(iso, n) {
            const [y, m, d] = iso.split('-').map(Number);
            const f = new Date(y, m - 1, d + n);
            return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
        },
        iniciales: (a, b) => `${(a || '').charAt(0)}${(b || '').charAt(0)}`.toUpperCase()
    };

    /** Escapa texto para insertarlo en HTML. */
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------- Notificaciones (toast) ---------- */
    function toast(mensaje, tipo = 'info', ms = 3800) {
        let box = document.getElementById('bg-toasts');
        if (!box) {
            box = document.createElement('div');
            box.id = 'bg-toasts';
            box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:min(380px,calc(100vw - 36px));';
            document.body.appendChild(box);
        }
        const colores = { info: '#0b2d4d', ok: '#16a085', error: '#e53935', warn: '#ff7a00' };
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.style.cssText = `background:${colores[tipo] || colores.info};color:#fff;padding:13px 16px;border-radius:10px;font:600 13px/1.45 Inter,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.2);opacity:0;transform:translateY(8px);transition:.25s;`;
        el.textContent = mensaje;
        box.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
    }

    /** Actualiza los enlaces de sesión del encabezado (elementos con data-auth-link / data-staff-link). */
    function renderHeader() {
        const u = session.user;
        document.querySelectorAll('[data-auth-link]').forEach(a => {
            if (u && session.token) {
                a.href = 'perfil.html';
                a.textContent = `👤 ${u.nombres.split(' ')[0]}`;
            } else {
                a.href = 'login.html';
                a.textContent = '👤 Ingresar';
            }
        });
        document.querySelectorAll('[data-staff-link]').forEach(a => {
            a.style.display = session.isStaff && session.token ? '' : 'none';
        });
    }

    function logout() {
        session.clear();
        location.href = 'index.html';
    }

    const params = new URLSearchParams(location.search);

    window.BusGlow = { api, session, requireLogin, fmt, esc, toast, renderHeader, logout, params, API_BASE };
    document.addEventListener('DOMContentLoaded', renderHeader);
})();
