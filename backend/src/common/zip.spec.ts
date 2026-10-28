import { crc32, inflateRawSync } from 'node:zlib';
import { createZip } from './zip';

/** Lee el directorio central y descomprime cada entrada (sólo para la prueba). */
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(pos)).toBe(0x02014b50);
    const size = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    const localName = zip.readUInt16LE(local + 26);
    const data = inflateRawSync(
      zip.subarray(local + 30 + localName, local + 30 + localName + size),
    );
    expect(crc32(data) >>> 0).toBe(zip.readUInt32LE(pos + 16));
    files[name] = data;
    pos += 46 + nameLength;
  }
  return files;
}

describe('createZip', () => {
  it('genera un ZIP válido con nombres UTF-8 y contenido íntegro', () => {
    const pdf = Buffer.from('%PDF-1.4 prueba');
    const zip = createZip([
      { name: 'facturas/A-101.pdf', data: pdf },
      { name: 'LEEME-descarga.txt', data: Buffer.from('Facturación ñandú') },
      { name: 'vacio.txt', data: Buffer.alloc(0) },
    ]);
    const files = readZip(zip);
    expect(files['facturas/A-101.pdf'].equals(pdf)).toBe(true);
    expect(files['LEEME-descarga.txt'].toString('utf8')).toBe(
      'Facturación ñandú',
    );
    expect(files['vacio.txt'].length).toBe(0);
  });

  it('rechaza rutas peligrosas y nombres repetidos', () => {
    expect(() => createZip([{ name: '../x', data: Buffer.alloc(1) }])).toThrow(
      'inválido',
    );
    expect(() => createZip([{ name: 'a\\b', data: Buffer.alloc(1) }])).toThrow(
      'inválido',
    );
    expect(() =>
      createZip([
        { name: 'a', data: Buffer.alloc(1) },
        { name: 'a', data: Buffer.alloc(1) },
      ]),
    ).toThrow('repetido');
  });
});
