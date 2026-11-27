import { toast } from 'svelte-sonner';

export function notifyFormResult(result: { type: string; data?: Record<string, unknown> }, keys: { success?: string; error?: string }) {
  if (result.type !== 'success' && result.type !== 'failure') return;
  const value = result.data?.[result.type === 'success' ? (keys.success ?? 'success') : (keys.error ?? 'message')];
  if (typeof value !== 'string') return;
  if (result.type === 'success') toast.success(value);
  else toast.error(value);
}
