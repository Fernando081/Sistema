import { validateCatalog } from "./catalog.mjs";
export function testPilotProduct(row) {
  if (!Number.isSafeInteger(row.id) || row.id < 1) throw new Error("ID de producto inválido");
  const slug = `${row.marca}-${row.codigo}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140).replace(/-$/g, "") + `-${row.id}`;
  const product = {
    slug, code: row.codigo, brand: row.marca, category: row.categoria, title: row.nombre,
    description: `${row.nombre}. Ficha de prueba; confirmar información antes de uso comercial.`,
    status: "published", approved: true,
    applications: (row.aplicaciones ?? []).map(item => ["fabricante", "modelo", "motor", "desde", "hasta", "restricciones"].map(key => item[key]).filter(value => value !== null && value !== undefined && value !== "").join(" · ")),
    references: (row.numerosParte ?? []).map(item => [item.tipo, item.fabricante, item.numero].filter(Boolean).join(" · ")),
    specifications: [],
  };
  return validateCatalog({ schemaVersion: 1, products: [product] })[0];
}
