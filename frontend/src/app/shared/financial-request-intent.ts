export class FinancialRequestIntent {
  private readonly pending = new Map<string, { signature: string; requestId: string }>();
  begin(kind: string, payload: unknown): string {
    const signature = JSON.stringify(payload);
    const old = this.pending.get(kind);
    if (old && old.signature !== signature)
      throw new Error(
        'Hay una operación pendiente de confirmar. Reintenta con los mismos datos o revisa el historial antes de registrar otra.',
      );
    const intent = old ?? { signature, requestId: crypto.randomUUID() };
    this.pending.set(kind, intent);
    return intent.requestId;
  }
  success(kind: string) {
    this.pending.delete(kind);
  }
  failure(kind: string, status: number) {
    if ([400, 401, 403, 404, 422].includes(status)) this.pending.delete(kind);
  }
}
