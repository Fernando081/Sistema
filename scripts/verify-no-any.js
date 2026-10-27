// Comprueba tipos any explícitos en producción; no sustituye tsc ni tipa FormGroup.
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', { paths: [path.resolve(__dirname, '../frontend')] }));
const root = path.resolve(__dirname, '..');
const errors = [];
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { inspect(file); continue; }
    if (!/\.(ts|html)$/.test(file) || /\.(spec|test|d)\.ts$/.test(file)) continue;
    const contents = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.ts')) {
      const source = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          errors.push(`${path.relative(root, file)}:${location.line + 1}: any explícito`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    if (/\$any\s*\(/.test(contents)) errors.push(`${path.relative(root, file)}: escape $any de plantilla`);
  }
}
for (const directory of ['backend/src', 'frontend/src']) inspect(path.join(root, directory));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Backend/frontend: 0 any explícitos en producción; 0 escapes $any de plantilla.');
