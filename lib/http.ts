/** Errors a route is allowed to show a user. Anything else becomes a 500 with
 *  no detail — an error message is an information disclosure channel. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Not signed in.") => new HttpError(401, m);
export const tooMany = (m: string) => new HttpError(429, m);

/**
 * Cross-tenant access lands here, not on a 403. A 403 would confirm the
 * resource exists and belongs to someone — this says nothing at all.
 */
export const notFound = (m = "Not found.") => new HttpError(404, m);

export const json = (data: unknown, status = 200) =>
  Response.json(data as any, { status });

/** Wraps a route handler so a thrown HttpError becomes its response. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong." }, 500);
    }
  };
}
