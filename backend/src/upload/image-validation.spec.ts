import { imageExtension } from './image-validation';

describe('imageExtension', () => {
  it('rechaza HTML aunque declare ser una imagen', () => {
    expect(imageExtension(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBeUndefined();
  });
  it('rechaza un archivo truncado que solo contiene la firma PNG', () => {
    expect(imageExtension(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]), 'image/png')).toBeUndefined();
  });
  it('acepta un PNG real y rechaza su declaración como JPEG', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1mUAAAAASUVORK5CYII=', 'base64');
    expect(imageExtension(png, 'image/png')).toBe('.png');
    expect(imageExtension(png, 'image/jpeg')).toBeUndefined();
  });
});
