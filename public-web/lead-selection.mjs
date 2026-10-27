import { inquiryPieces } from "./inquiry.mjs";

// Only public part selections belong in this GET query. Contacts remain POST-only.
export function leadSelection(products, params) {
  for (const key of params.keys())
    if (
      !["producto", "cantidad", "piezas"].includes(key) ||
      params.getAll(key).length !== 1
    )
      throw new Error("Selección inválida");
  if (![...params.keys()].length) return { items: [] };
  const product = products.find((item) => item.slug === params.get("producto"));
  if (!product) return null;
  const quantity = params.get("cantidad") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(quantity)) throw new Error("Cantidad inválida");
  return {
    items: inquiryPieces(
      products,
      product,
      quantity,
      params.get("piezas") ?? "",
    ).map(({ product, quantity }) => ({
      kind: "catalog",
      slug: product.slug,
      quantity,
    })),
  };
}
