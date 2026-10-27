// Evita reintroducir artefactos de conflictos y plantillas Angular vacías.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const errors = [];
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { inspect(file); continue; }
    const relative = path.relative(root, file);
    if (/\.(orig|rej)$/.test(file)) errors.push(`${relative}: residuo de conflicto`);
    if (/\.(ts|html|css|scss)$/.test(file)) {
      const contents = fs.readFileSync(file, 'utf8');
      if (/^(?:<<<<<<< |=======\s*$|>>>>>>> )/m.test(contents)) errors.push(`${relative}: marcador de conflicto`);
      if (file.endsWith('.html') && /^\s*<p>[\w-]+ works!<\/p>\s*$/.test(contents)) {
        errors.push(`${relative}: plantilla generada sin funcionalidad`);
      }
    }
  }
}
for (const directory of ['backend/src', 'frontend/src']) inspect(path.join(root, directory));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Repositorio sin residuos de conflictos ni plantillas placeholder.');
