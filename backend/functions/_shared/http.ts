export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as {message: unknown}).message);
  return String(error || 'Unexpected server error');
}
export function sha256Hex(value: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(hash =>
    [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
  );
}
export async function consumeRateLimit(client: any, request: Request, bucketName: string, max = 30, windowSeconds = 60): Promise<boolean> {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('cf-connecting-ip') || 'unknown';
  const key = await sha256Hex(`${bucketName}:${forwarded}`);
  const { data, error } = await client.rpc('arcade_consume_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw error;
  return data === true;
}
export const isOptions = (request: Request) => request.method === 'OPTIONS';
