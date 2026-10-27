import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WebProductEditorComponent } from './web-product-editor.component';
import { environment } from '../../environments/environment';
describe('Editor web', () => {
  let editor: WebProductEditorComponent;
  let http: HttpTestingController;
  const url = `${environment.apiBaseUrl}/web-catalog/admin/products/42`;
  const producto = {
    codigo: 'ABC-42',
    nombre: 'Filtro de combustible',
    marca: 'Marca',
    imagenes: ['/uploads/filtro.png'],
    numerosParte: [],
    aplicaciones: [],
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WebProductEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    editor = TestBed.createComponent(WebProductEditorComponent).componentInstance;
    editor.productId = 42;
    http = TestBed.inject(HttpTestingController);
    editor.ngOnInit();
    http.expectOne(url).flush({ producto, ficha: null });
    editor.form.patchValue({
      titulo: 'Filtro real revisado',
      descripcion: 'Descripción comercial revisada para este producto real.',
    });
  });
  afterEach(() => http.verify());
  it('consulta recibo y revoca solo tras confirmación explícita', () => {
    editor.setReceiptLookup('9');
    editor.checkReceipt();
    http
      .expectOne(`${url}/approvals/9`)
      .flush({ receiptId: 9, version: 2, sha256: 'hash', revoked: false, active: true });
    expect(editor.receiptStatus()?.active).toBeTrue();
    editor.revokeReceipt();
    http.expectNone(`${url}/approvals/9/revoke`);
    editor.revokeConfirmed.set(true);
    editor.revokeReceipt();
    editor.revokeReceipt();
    const request = http.expectOne(`${url}/approvals/9/revoke`);
    expect(request.request.body).toEqual({ confirmed: true });
    request.flush({ revoked: true });
    expect(editor.receiptStatus()?.revoked).toBeTrue();
    expect(editor.receiptStatus()?.active).toBeFalse();
    expect(editor.message()).toContain('retiro por separado');
  });
  it('recibo inválido o inexistente no habilita revocación', () => {
    editor.setReceiptLookup('1.5');
    editor.checkReceipt();
    http.expectNone(`${url}/approvals/1.5`);
    editor.setReceiptLookup('9');
    editor.checkReceipt();
    http.expectOne(`${url}/approvals/9`).flush({}, { status: 404, statusText: 'Not found' });
    expect(editor.receiptStatus()).toBeNull();
    expect(editor.exporting()).toBeFalse();
  });
  it('aprobación explícita descarga bytes exactos y muestra recibo sin activar sitio', () => {
    editor.state.set('listo');
    editor.version.set(2);
    editor.form.patchValue({
      datosRealesConfirmados: true,
      derechosImagenConfirmados: true,
      compatibilidadVerificada: true,
    });
    editor.form.markAsPristine();
    const download = spyOn(editor, 'downloadRaw');
    editor.approveCandidate();
    http.expectNone(`${url}/approve-candidate`);
    editor.approvalConfirmed.set(true);
    editor.approveCandidate();
    const request = http.expectOne(`${url}/approve-candidate`);
    expect(request.request.body).toEqual({ version: 2, confirmed: true });
    const raw = '{ "schemaVersion": 1, "products": [] }';
    request.flush({ raw, sha256: 'hash', receipt: { id: 9, timestamp: 'test' } });
    expect(download).toHaveBeenCalledOnceWith(raw, 'ficha-aprobada-42.json');
    expect(editor.approvalReceipt()?.id).toBe(9);
    expect(editor.message()).toContain('no se ha activado');
    editor.form.controls.titulo.setValue('Texto editado posteriormente');
    expect(editor.approvalReceipt()).toBeNull();
    expect(editor.approvalConfirmed()).toBeFalse();
  });
  it('conflicto de aprobación conserva texto y bloquea reintento hasta cargar', () => {
    editor.state.set('listo');
    editor.version.set(2);
    editor.form.patchValue({
      datosRealesConfirmados: true,
      derechosImagenConfirmados: true,
      compatibilidadVerificada: true,
    });
    editor.form.markAsPristine();
    editor.approvalConfirmed.set(true);
    editor.approveCandidate();
    http.expectOne(`${url}/approve-candidate`).flush({}, { status: 409, statusText: 'Conflict' });
    expect(editor.conflict()).toBeTrue();
    expect(editor.exporting()).toBeFalse();
    expect(editor.approvalReceipt()).toBeNull();
  });
  it('descarga candidata solo lista y bloquea peticiones duplicadas', () => {
    editor.state.set('listo');
    editor.form.patchValue({
      datosRealesConfirmados: true,
      derechosImagenConfirmados: true,
      compatibilidadVerificada: true,
    });
    editor.form.markAsPristine();
    const download = spyOn(editor, 'downloadCandidate');
    editor.exportCandidate();
    editor.exportCandidate();
    const request = http.expectOne(`${url}/export-candidate`);
    const candidate = { schemaVersion: 1, products: [] };
    request.flush(candidate);
    expect(download).toHaveBeenCalledOnceWith(candidate);
    expect(editor.exporting()).toBeFalse();
    expect(editor.message()).toContain('no publica');
  });
  it('no exporta borrador ni cambios sin guardar', () => {
    editor.exportCandidate();
    http.expectNone(`${url}/export-candidate`);
    editor.state.set('listo');
    editor.form.markAsDirty();
    editor.exportCandidate();
    http.expectNone(`${url}/export-candidate`);
  });
  it('incluye solo equivalencias elegidas manualmente', () => {
    editor.product.set({
      ...producto,
      equivalencias: [{ id: 2, codigo: 'EQ-42', nombre: 'Equivalente', marca: 'Marca' }],
    });
    expect(editor.selectedEquivalents()).toEqual([]);
    editor.selectEquivalent(2, true);
    editor.save('borrador');
    const request = http.expectOne(url);
    expect(request.request.body.equivalencias).toEqual([2]);
    request.flush({ ...editor.form.getRawValue(), estado: 'borrador', version: 1 });
  });
  it('guarda solo fotos seleccionadas y características con unidad', () => {
    editor.addSpecification({ nombre: 'Altura', valor: '120', unidad: 'mm' });
    editor.save('borrador');
    const request = http.expectOne(url);
    expect(request.request.body.imagenes).toEqual(['/uploads/filtro.png']);
    expect(request.request.body.especificaciones).toEqual([
      { nombre: 'Altura', valor: '120', unidad: 'mm' },
    ]);
    request.flush({ ...editor.form.getRawValue(), estado: 'borrador', version: 1 });
  });
  it('reinicia confirmaciones al editar y bloquea aprobar una foto rota', () => {
    editor.form.patchValue({
      datosRealesConfirmados: true,
      derechosImagenConfirmados: true,
      compatibilidadVerificada: true,
    });
    editor.form.controls.titulo.setValue('Título comercial cambiado');
    expect(editor.form.controls.datosRealesConfirmados.value).toBeFalse();
    editor.form.patchValue({
      datosRealesConfirmados: true,
      derechosImagenConfirmados: true,
      compatibilidadVerificada: true,
    });
    editor.imageFailed('/uploads/filtro.png');
    editor.save('listo');
    http.expectNone(url);
    expect(editor.requirements()).toContain('Revisar imágenes que no cargaron');
  });
  it('no aprueba sin confirmaciones manuales', () => {
    editor.save('listo');
    http.expectNone(url);
    expect(editor.requirements().length).toBe(3);
  });
  it('conserva texto ante conflicto y reinicia revisión al recargar versión', () => {
    editor.save('borrador');
    const req = http.expectOne(url);
    expect(req.request.body.version).toBe(0);
    req.flush({}, { status: 409, statusText: 'Conflict' });
    editor.save('borrador');
    http.expectNone(url);
    editor.load(true);
    http
      .expectOne(url)
      .flush({ producto, ficha: { version: 7, estado: 'borrador', titulo: 'Otra edición' } });
    expect(editor.form.controls.titulo.value).toBe('Filtro real revisado');
    expect(editor.version()).toBe(7);
    expect(editor.form.controls.datosRealesConfirmados.value).toBeFalse();
  });
  it('conserva texto y libera guardado después de error de red', () => {
    editor.save('borrador');
    http.expectOne(url).error(new ProgressEvent('error'));
    expect(editor.saving()).toBeFalse();
    expect(editor.form.controls.titulo.value).toBe('Filtro real revisado');
    editor.save('borrador');
    http.expectOne(url).flush({ ...editor.form.getRawValue(), estado: 'borrador', version: 1 });
    expect(editor.version()).toBe(1);
  });
});
