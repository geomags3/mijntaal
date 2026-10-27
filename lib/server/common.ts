import { env } from 'cloudflare:workers';
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function owner(r: Request) {
  const id = r.headers.get('oai-authenticated-user-id');
  if (!id) throw new AppError('Please sign in with ChatGPT.', 401);
  return id;
}
export function mutation(r: Request) {
  const origin = r.headers.get('origin');
  if (origin && origin !== new URL(r.url).origin)
    throw new AppError('Request origin is not allowed.', 403);
}
export const db = () => {
  if (!env.DB) throw new AppError('Storage is unavailable. Please try again.', 503);
  return env.DB;
};
export function fail(e: unknown) {
  const known = e instanceof AppError;
  return Response.json(
    { error: known ? e.message : 'Something went wrong. Please try again.' },
    { status: known ? e.status : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function json(value: unknown) {
  return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
}
export async function body(r: Request) {
  if (Number(r.headers.get('content-length') || 0) > 100000)
    throw new AppError('Request is too large.', 413);
  const text = await r.text();
  if (text.length > 100000) throw new AppError('Request is too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('Invalid request.');
  }
}
export async function hash(text: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function limit(user: string, kind: string, count = 30) {
  const id = 'limit:' + (await hash(user + kind + new Date().toISOString().slice(0, 16)));
  await db()
    .prepare(
      'INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=CAST(CAST(body AS INTEGER)+1 AS TEXT)',
    )
    .bind(id, user, '1', new Date().toISOString())
    .run();
  const row: any = await db().prepare('SELECT body FROM lookup_cache WHERE id=?').bind(id).first();
  if (Number(row?.body) > count)
    throw new AppError('Please wait a minute before making more requests.', 429);
}
