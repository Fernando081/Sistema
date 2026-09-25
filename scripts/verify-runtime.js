'use strict';

const expectedMajor = 24;
const actualMajor = Number(process.versions.node.split('.')[0]);

if (actualMajor !== expectedMajor) {
  console.error(
    `Este proyecto requiere Node ${expectedMajor} LTS. Versión actual: ${process.versions.node}. ` +
      'Ejecuta el cambio indicado en .nvmrc antes de instalar o validar.',
  );
  process.exit(1);
}

console.log(`Runtime correcto: Node ${process.versions.node}.`);
