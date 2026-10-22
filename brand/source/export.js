// يطلّع PNG من ملفات SVG — usage: node export.js <svg-dir> <png-dir>
const sharp = require('sharp'); const fs = require('fs'); const path = require('path');
const [,, src, dst] = process.argv; fs.mkdirSync(dst, { recursive: true });
const jobs = [
  ['icon.svg', 'icon-1024.png', 1024, 1024], ['icon.svg', 'icon-512.png', 512, 512], ['icon.svg', 'icon-192.png', 192, 192],
  ['icon.svg', 'apple-touch-icon.png', 180, 180], ['icon-maskable.svg', 'icon-maskable-512.png', 512, 512],
  ['icon-scene.svg', 'splash-1024.png', 1024, 1024], ['favicon.svg', 'favicon-32.png', 32, 32], ['favicon.svg', 'favicon-16.png', 16, 16],
  ['logo-sign.svg', 'logo-sign.png', 960, 560], ['logo-sign-night.svg', 'logo-sign-night.png', 960, 560],
];
(async () => { for (const [i, o, w, h] of jobs)
  await sharp(path.join(src, i), { density: 300 }).resize(w, h).flatten({ background: '#143C38' }).png().toFile(path.join(dst, o));
  console.log(jobs.length + ' png'); })();
