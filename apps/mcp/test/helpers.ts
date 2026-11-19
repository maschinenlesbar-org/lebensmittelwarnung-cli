// Test helpers of this server's own tests and the adapters of the conformance tests: a mock
// upstream shaped like the portal's RSS feed (the client's fixtures: live-shaped notices, filtered
// by state and type as the live feed does), and the client's transport helpers. The generic
// harness (a connection, a config, a log recorder, the HTTP server) is harness.ts.

import type { HttpResponse } from "@maschinenlesbar.org/lebensmittelwarnung-client";

export * from "@maschinenlesbar.org/lebensmittelwarnung-client/test/helpers";
export * from "@maschinenlesbar.org/lebensmittelwarnung-client/test/fixtures";

/** A JSON answer (an error page the portal might send). */
export function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) };
}
