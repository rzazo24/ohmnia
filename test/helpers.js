// Respuesta mínima compatible con la de las funciones de Vercel.
export function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}
