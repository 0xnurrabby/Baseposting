// Ensures fetch is available in Node runtimes where it may be missing.
// Safe to import multiple times.
import { fetch as undiciFetch, Headers, Request, Response } from 'undici'

const g: any = globalThis as any

if (typeof g.fetch !== 'function') {
  g.fetch = undiciFetch
  g.Headers = Headers
  g.Request = Request
  g.Response = Response
}
