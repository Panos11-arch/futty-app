import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * supabase.functions.invoke() puts only a generic "Edge Function returned a
 * non-2xx status code" in error.message — the actual JSON body our own
 * functions return (e.g. { error: "too_late_to_cancel" }) is only reachable
 * via error.context, the raw Response object supabase-js wraps but never
 * reads for you. Confirmed directly this session: several real error
 * messages (Apple verification failures, "not a captain", etc.) were being
 * silently replaced by that generic string, only visible by digging into
 * Edge Function logs. Every caller should go through this instead of
 * reading error.message directly.
 */
export async function describeFunctionError(error: unknown): Promise<string> {
  return (await readFunctionError(error)).message;
}

/**
 * The same message as describeFunctionError, plus the function's whole JSON
 * body when it sent one (e.g. { error, reason: 'money_owed', owed_cents }),
 * for callers that act on more than the message. A Response body can only
 * be read once, so read it through here, not twice.
 */
export async function readFunctionError(
  error: unknown
): Promise<{ message: string; body: Record<string, unknown> | null }> {
  if (error instanceof FunctionsHttpError) {
    try {
      const text = await error.context.text();
      try {
        const body = JSON.parse(text);
        if (body && typeof body === 'object' && typeof body.error === 'string') return { message: body.error, body };
      } catch {
        // Not JSON — a plain-text Response body (e.g. "Unauthorized") is
        // already a reasonable message on its own.
      }
      if (text) return { message: text, body: null };
    } catch {
      // context wasn't readable at all — fall through to the generic message.
    }
  }
  return { message: error instanceof Error ? error.message : 'Something went wrong.', body: null };
}
