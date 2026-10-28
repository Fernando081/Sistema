import { isApiUrl } from './api-url';

describe('API credential boundary', () => {
  const origin = 'https://erp.example';
  const accepts = (url: string) => isApiUrl(url, '/api/v1', origin);
  it('accepts relative and absolute requests to the configured API', () => {
    expect(accepts('/api/v1/venta')).toBeTrue();
    expect(accepts('https://erp.example/api/v1/auth/me')).toBeTrue();
  });
  it('rejects prefix collisions, external domains and path escapes', () => {
    expect(accepts('/api/v1-externo')).toBeFalse();
    expect(accepts('https://erp.example.evil.test/api/v1/venta')).toBeFalse();
    expect(accepts('//external.test/api/v1/venta')).toBeFalse();
    expect(accepts('/api/v1/../../other')).toBeFalse();
  });
  it('honors a separately configured backend origin without trusting suffixes', () => {
    expect(
      isApiUrl('https://api.example/api/v1/venta', 'https://api.example/api/v1', origin),
    ).toBeTrue();
    expect(
      isApiUrl('https://api.example.evil.test/api/v1/venta', 'https://api.example/api/v1', origin),
    ).toBeFalse();
  });
});
