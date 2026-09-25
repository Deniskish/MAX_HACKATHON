// Ядро OCR и языки обслуживаются нашим приложением; документы не уходят на CDN.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'public', 'ocr');
fs.mkdirSync(path.join(target, 'core'), { recursive: true });
fs.mkdirSync(path.join(target, 'lang'), { recursive: true });
const core = path.join(root, 'node_modules', 'tesseract.js-core');
for (const file of fs.readdirSync(core).filter((name) => /^tesseract-core.*\.(js|wasm)$/.test(name))) fs.copyFileSync(path.join(core, file), path.join(target, 'core', file));
for (const lang of ['rus', 'eng']) fs.copyFileSync(path.join(root, 'node_modules', '@tesseract.js-data', lang, '4.0.0', `${lang}.traineddata.gz`), path.join(target, 'lang', `${lang}.traineddata.gz`));
