import { createHash } from 'node:crypto';

const { canonicalChecksum, matchesChecksum } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../migration-checksum') as {
    canonicalChecksum: (content: Buffer | string) => string;
    matchesChecksum: (stored: string, content: Buffer | string) => boolean;
  };
const sha = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

describe('migration-checksum (H02-e)', () => {
  const lf = 'CREATE TABLE x (id int);\nINSERT INTO x VALUES (1);\n';
  const crlf = lf.replace(/\n/g, '\r\n');

  it('el checksum canónico no depende del fin de línea', () => {
    expect(canonicalChecksum(Buffer.from(crlf))).toBe(
      canonicalChecksum(Buffer.from(lf)),
    );
    expect(canonicalChecksum(lf)).toBe(sha(lf));
  });

  it('acepta checksums históricos de bytes crudos CRLF o LF en cualquier copia', () => {
    for (const stored of [sha(crlf), sha(lf)]) {
      expect(matchesChecksum(stored, Buffer.from(lf))).toBe(true);
      expect(matchesChecksum(stored, Buffer.from(crlf))).toBe(true);
    }
  });

  it('acepta un archivo con finales mezclados sólo por sus bytes exactos', () => {
    const mixed = Buffer.from('a;\r\nb;\nc;\r\n');
    expect(matchesChecksum(sha(mixed), mixed)).toBe(true);
    expect(matchesChecksum(sha(mixed), Buffer.from('a;\nb;\nc;\n'))).toBe(
      false,
    );
  });

  it('rechaza un cambio de contenido', () => {
    expect(matchesChecksum(sha(lf), Buffer.from(lf + '-- cambio\n'))).toBe(
      false,
    );
  });
});
