const cfg = window.ARCADE_CONFIG || {};
export const backendConfigured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase?.createClient);
export const supabase = backendConfigured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
}) : null;
export const eventName = cfg.eventName || 'GDGoC NDU Arcade Challenge';
export function publicBaseUrl() {
  const configured = (cfg.publicBaseUrl || '').trim();
  if (configured) return configured.endsWith('/') ? configured : `${configured}/`;
  const current = new URL('.', window.location.href);
  return current.href;
}
export function isLocalHost() {
  return ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.protocol === 'file:';
}
export function explainBackendMissing() {
  return 'Backend not configured. This page is in local preview mode; phones on other devices will not share the queue until Supabase is configured.';
}
