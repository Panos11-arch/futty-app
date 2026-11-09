// The slice of the Supabase client the payment Edge Functions use: calling
// database functions. Every payment rule lives in SQL; the functions only
// call it and Stripe. Tests pass _shared/db-fake.ts instead.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

export type Db = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

/** A database function raised an exception; `message` is its code (e.g. 'not_your_share'). */
export class DbError extends Error {}

export function dbFromSupabase(client: SupabaseClient): Db {
  return { rpc: (fn, args) => client.rpc(fn, args) };
}

/** Calls a database function and returns its result, throwing DbError if it raised. */
export async function rpc<T>(db: Db, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new DbError(error.message);
  return data as T;
}
