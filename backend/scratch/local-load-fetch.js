const contexts = new WeakMap();
function diagnosticError(error, context, stage) {
  const diagnostic = {
    ...context,
    stage,
    name: error.name,
    code: error.cause?.code ?? error.code ?? null,
  };
  return Object.assign(
    new Error(
      `HTTP ${context.method} ${context.route}: ${stage}; ${error.name}; ${diagnostic.code ?? 'sin codigo de transporte'}`,
      { cause: error },
    ),
    { diagnostic },
  );
}
async function localLoadFetch(url, options) {
  const context = {
    method: options?.method ?? 'GET',
    route: new URL(url).pathname,
  };
  try {
    const response = await fetch(url, options);
    contexts.set(response, context);
    return response;
  } catch (error) {
    throw diagnosticError(error, context, 'headers');
  }
}
async function readLoadBody(response, kind = 'json') {
  if (!['json', 'text', 'arrayBuffer'].includes(kind))
    throw new Error('Tipo de lectura desconocido');
  try {
    return await response[kind]();
  } catch (error) {
    throw diagnosticError(
      error,
      contexts.get(response) ?? { method: 'UNKNOWN', route: 'unknown' },
      'body-' + kind,
    );
  }
}
module.exports = { localLoadFetch, readLoadBody };
