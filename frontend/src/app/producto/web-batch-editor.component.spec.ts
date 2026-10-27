import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WebBatchEditorComponent } from './web-batch-editor.component';
import { environment } from '../../environments/environment';
describe('Revisión administrativa de lote', () => {
  it('variantes requieren autorización y se rechaza JSON anidado malformado', () => {
    component.members.set([{ productId: 1, version: 1 }]);
    component.raw = JSON.stringify({
      schemaVersion: 1,
      products: [
        {
          slug: 'uno',
          title: 'Uno',
          code: 'A',
          images: [
            {
              file: 'a.png',
              alt: 'Foto',
              authorized: true,
              width: 800,
              height: 800,
              sha256: 'hash',
              variants: [
                {
                  file: 'b.png',
                  alt: 'Foto',
                  authorized: false,
                  width: 320,
                  height: 320,
                  sha256: 'hash',
                },
              ],
            },
          ],
        },
      ],
    });
    component.parseVisual();
    expect(component.visualReady()).toBeFalse();
    component.products()[0].images![0].variants![0].authorized = true;
    expect(component.visualReady()).toBeTrue();
    component.raw = component.raw.replace('"variants":[', '"variants":{} ,"invalid":[');
    component.parseVisual();
    expect(component.visualReady()).toBeFalse();
  });
  let component: WebBatchEditorComponent;
  let http: HttpTestingController;
  const url = `${environment.apiBaseUrl}/web-catalog/admin/products`;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WebBatchEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(WebBatchEditorComponent).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('rechaza IDs duplicados y prepara versiones sin aprobar automáticamente', () => {
    component.ids = '1,1';
    component.prepare();
    http.expectNone(url + '/1');
    component.ids = '1,2';
    component.prepare();
    for (const id of [1, 2]) {
      http.expectOne(url + '/' + id).flush({ ficha: { version: id } });
      http.expectOne(url + '/' + id + '/export-candidate').flush({
        products: [
          {
            slug: 'ficha-' + id,
            title: 'Fixture',
            code: 'TEST',
            status: 'draft',
            approved: false,
          },
        ],
      });
    }
    expect(component.members()).toEqual([
      { productId: 1, version: 1 },
      { productId: 2, version: 2 },
    ]);
    expect(JSON.parse(component.raw).products.length).toBe(2);
    expect(component.confirmed).toBeFalse();
    component.approve();
    http.expectNone(url + '/batch/approve');
  });
  it('la revisión visual conserva campos y limpia confirmación al cambiar alternativas', () => {
    component.members.set([
      { productId: 1, version: 1 },
      { productId: 2, version: 1 },
    ]);
    component.raw = JSON.stringify({
      schemaVersion: 1,
      products: [
        { slug: 'uno', title: 'Uno', code: 'A', description: 'Conservar' },
        { slug: 'dos', title: 'Dos', code: 'B' },
      ],
    });
    component.parseVisual();
    component.confirmed = true;
    component.alternative(component.products()[0], 'dos', true);
    expect(component.confirmed).toBeFalse();
    expect(JSON.parse(component.raw).products[0].description).toBe('Conservar');
    expect(JSON.parse(component.raw).products[0].alternatives).toEqual(['dos']);
    component.raw = 'malformado';
    component.parseVisual();
    expect(component.visualReady()).toBeFalse();
  });
  it('imágenes sin derechos o texto bloquean la aprobación visual', () => {
    component.products.set([
      {
        slug: 'uno',
        title: 'Uno',
        code: 'A',
        images: [
          { file: 'x.png', sha256: 'hash', alt: '', authorized: false, width: 1, height: 1 },
        ],
      },
    ]);
    expect(component.visualReady()).toBeFalse();
    const image = component.products()[0].images![0];
    image.alt = 'Descripción';
    image.authorized = true;
    expect(component.visualReady()).toBeTrue();
    component.raw = JSON.stringify({ schemaVersion: 1, products: component.products() });
    component.removeImage(component.products()[0], image);
  });
  it('un fallo de preparación descarta todo el lote', () => {
    component.ids = '1';
    component.prepare();
    http.expectOne(url + '/1').flush({ ficha: { version: 1 } });
    http
      .expectOne(url + '/1/export-candidate')
      .flush({}, { status: 400, statusText: 'Bad request' });
    expect(component.members()).toEqual([]);
    expect(component.raw).toBe('');
    expect(component.busy()).toBeFalse();
  });
  it('envía manifiesto exacto y versiones y exige nueva revisión tras rechazo', () => {
    component.members.set([{ productId: 1, version: 2 }]);
    component.raw = '{"schemaVersion":1}';
    component.confirmed = true;
    component.approve();
    const req = http.expectOne(url + '/batch/approve');
    expect(req.request.body).toEqual({
      raw: component.raw,
      members: [{ productId: 1, version: 2 }],
      confirmed: true,
    });
    req.flush({}, { status: 409, statusText: 'Conflict' });
    expect(component.confirmed).toBeFalse();
    expect(component.busy()).toBeFalse();
  });
  it('revocación exige consulta y confirmación; cambiar recibo elimina el resultado', () => {
    component.receipt = '9';
    component.consult();
    http
      .expectOne(url + '/batch/approvals/9')
      .flush({ receiptId: 9, active: true, revoked: false, productCount: 1, sha256: 'hash' });
    component.revoke();
    http.expectNone(url + '/batch/approvals/9/revoke');
    component.revokeConfirmed = true;
    component.revoke();
    http.expectOne(url + '/batch/approvals/9/revoke').flush({ revoked: true });
    expect(component.status()?.revoked).toBeTrue();
    component.changed();
    expect(component.status()).toBeNull();
    expect(component.revokeConfirmed).toBeFalse();
  });
});
