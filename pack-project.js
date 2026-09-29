#!/usr/bin/env node
// =====================================================================
// pack-project.js — Empaqueta el proyecto en carniceria-erp-system.zip
// Excluye node_modules, dist, cachés, .env con secretos y zips previos.
// Uso:  node pack-project.js            (o npm run pack)
//       node pack-project.js --out ../entregas/cliente-x.zip
// Usa `archiver` si está instalado; si no, recurre al `zip` / PowerShell del sistema.
// =====================================================================
import { createWriteStream, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > -1 && process.argv[outArg + 1] ? process.argv[outArg + 1] : join(ROOT, 'carniceria-erp-system.zip'));
const PREFIX = 'carniceria-erp-system';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', '.vite', 'coverage', '.turbo', '.next', '.supabase', '.idea', '.vscode']);
const EXCLUDED_FILES = [/^\.env$/, /^\.env\.(?!example$).+/, /\.zip$/, /^\.DS_Store$/, /^Thumbs\.db$/, /\.log$/, /\.tsbuildinfo$/];

function collect(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!EXCLUDED_DIRS.has(name)) collect(full, acc);
    } else if (!EXCLUDED_FILES.some((re) => re.test(name)) && resolve(full) !== OUT) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collect(ROOT);
const human = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);
if (existsSync(OUT)) unlinkSync(OUT);

async function withArchiver() {
  const { default: archiver } = await import('archiver');
  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(OUT);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolvePromise);
    archive.on('warning', (err) => (err.code === 'ENOENT' ? console.warn(err.message) : reject(err)));
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) {
      archive.file(f, { name: `${PREFIX}/${relative(ROOT, f).split(sep).join('/')}` });
    }
    void archive.finalize();
  });
}

function withSystemZip() {
  const rel = files.map((f) => relative(ROOT, f));
  if (process.platform === 'win32') {
    const list = rel.map((r) => `'${r.replace(/'/g, "''")}'`).join(',');
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path ${list} -DestinationPath '${OUT}' -CompressionLevel Optimal`], { cwd: ROOT, stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-q', '-9', OUT, ...rel], { cwd: ROOT, stdio: 'inherit' });
  }
}

try {
  try {
    await withArchiver();
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    console.log('ℹ archiver no instalado; usando compresor del sistema…');
    withSystemZip();
  }
  const size = statSync(OUT).size;
  console.log(`✔ ${files.length} archivos empaquetados → ${relative(process.cwd(), OUT) || OUT} (${human(size)})`);
  console.log('  Excluidos: node_modules, dist, .env*, cachés y zips previos.');
} catch (err) {
  console.error('✖ Error al empaquetar:', err.message);
  process.exit(1);
}
