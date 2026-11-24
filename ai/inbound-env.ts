// Loaded first by ai/inbound.ts: ai-import.ts starts its own server unless told it is embedded, and inbound only borrows
// its handler (the same extraction code path, in process). Its own module so it runs before that import.
// (Deno.env.set is NotSupported on Supabase's edge runtime, hence a global flag.)
(globalThis as Record<string, unknown>).__AI_IMPORT_EMBEDDED = true;
