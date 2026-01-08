// api/_lib/polyfill.ts
// Ensures global fetch exists in Node runtimes where it's missing/disabled.
// Safe to import multiple times.
import { fetch as undiciFetch, Headers, Request, Response } from "undici";

const g: any = globalThis as any;

if (typeof g.fetch !== "function") {
  g.fetch = undiciFetch as any;
  g.Headers = Headers as any;
  g.Request = Request as any;
  g.Response = Response as any;
}
