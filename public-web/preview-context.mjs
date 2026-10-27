export const TEST_PILOT_MODE = "test-db-pilot";
export function validatePreviewMode(mode) {
  if (mode !== undefined && mode !== TEST_PILOT_MODE) throw new Error("Modo de preview inválido");
  return mode;
}
export function previewContextHtml(html, mode) {
  validatePreviewMode(mode);
  if (mode === undefined) return html;
  const marker = /(<div class="preview-bar"[^>]*>)[^<]*(<\/div>)/;
  if (!marker.test(html)) throw new Error("Preview sin aviso de contexto");
  return html.replace(marker, "$1Piloto técnico · Datos de prueba · Sin oferta comercial$2");
}
