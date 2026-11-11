/** Ejecuta un archivo .sql separado por lotes "GO" (como SSMS). */
const fs = require('fs');

async function runSqlFile(pool, file, { skipUse = false } = {}) {
    const content = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const batches = content.split(/^\s*GO\s*;?\s*$/gim).map(b => b.trim()).filter(Boolean);
    for (const batch of batches) {
        // La conexión ya apunta a la base correcta; se omiten CREATE DATABASE / USE
        if (skipUse && /^\s*(IF DB_ID\(|USE\s+)/i.test(batch.replace(/\/\*[\s\S]*?\*\//g, '').trim())) continue;
        await pool.request().batch(batch);
    }
    return batches.length;
}

module.exports = { runSqlFile };
