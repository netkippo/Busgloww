/**
 * MODELO: Pago — pasarela de pagos SIMULADA (reemplazable por Culqi / Niubiz / Stripe).
 * Tarjetas de prueba: 4111 1111 1111 1111 (aprobada) | 4000 0000 0000 0002 (rechazada)
 */
const { HttpError } = require('../utils/http');
const { randomCode } = require('../utils/security');

const METODOS = ['TARJETA', 'YAPE', 'PLIN', 'EFECTIVO'];

/** Algoritmo de Luhn para validar números de tarjeta. */
function luhn(numero) {
    let suma = 0, doble = false;
    for (let i = numero.length - 1; i >= 0; i--) {
        let d = parseInt(numero[i], 10);
        if (doble) { d *= 2; if (d > 9) d -= 9; }
        suma += d;
        doble = !doble;
    }
    return suma % 10 === 0;
}

/** Devuelve { aprobado, codigo, detalle, mensaje }. Lanza HttpError 400 si los datos son inválidos. */
function procesar(metodo, datos = {}) {
    const codigo = randomCode('OP', 10);
    if (metodo === 'TARJETA') {
        const numero = String(datos.numero || '').replace(/\D/g, '');
        const [mes, anio] = String(datos.vencimiento || '').split('/').map(n => parseInt(n, 10));
        if (numero.length < 13 || numero.length > 19 || !luhn(numero)) {
            throw new HttpError(400, 'El número de tarjeta no es válido.');
        }
        if (!mes || !anio || mes < 1 || mes > 12) throw new HttpError(400, 'Fecha de vencimiento inválida (MM/AA).');
        const venc = new Date(2000 + (anio % 100), mes, 0, 23, 59);
        if (venc < new Date()) throw new HttpError(400, 'La tarjeta está vencida.');
        if (!/^\d{3,4}$/.test(String(datos.cvv || ''))) throw new HttpError(400, 'El CVV no es válido.');
        const aprobado = !numero.endsWith('0002');
        return { aprobado, codigo, detalle: `TARJETA ****${numero.slice(-4)}`, mensaje: aprobado ? null : 'Pago rechazado por la entidad emisora (fondos insuficientes).' };
    }
    if (metodo === 'YAPE' || metodo === 'PLIN') {
        if (!/^9\d{8}$/.test(String(datos.celular || '').replace(/\D/g, ''))) {
            throw new HttpError(400, 'Ingresa un número de celular válido (9 dígitos).');
        }
        if (!/^\d{6}$/.test(String(datos.codigo_aprobacion || ''))) {
            throw new HttpError(400, 'Ingresa el código de aprobación de 6 dígitos.');
        }
        return { aprobado: true, codigo, detalle: metodo };
    }
    if (metodo === 'EFECTIVO') {
        return { aprobado: true, codigo, detalle: 'EFECTIVO' };
    }
    throw new HttpError(400, 'Método de pago no soportado.');
}

module.exports = { METODOS, procesar, luhn };
