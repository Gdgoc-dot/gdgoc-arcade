export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function toast(message, type = 'success', timeout = 3400) {
  const region = $('#toast-region');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = String(message);
  region.append(item);
  window.setTimeout(() => item.remove(), timeout);
}
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function cleanNickname(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
}
export async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function makeToken() {
  const data = new Uint8Array(32);
  crypto.getRandomValues(data);
  return [...data].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function formatTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
export function safeDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => {
    const cell = String(value ?? '');
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export function debounce(fn, delay = 180) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
