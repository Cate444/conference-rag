import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

/**
 * Verifies the caller is a logged-in user.
 *
 * We deploy with --no-verify-jwt because Supabase's gateway can't yet verify
 * the newer (ES256) session tokens. So we check the token ourselves here by
 * asking Supabase Auth "who does this token belong to?" via getUser().
 *
 * Returns { user } on success, or { error: Response } (a 401) on failure.
 */
export async function requireAuth(req: Request): Promise<
    { user: { id: string; email?: string } } | { error: Response }
> {
    // The browser sends "Authorization: Bearer <JWT>" automatically
    // when you call supabaseClient.functions.invoke() while logged in.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        return { error: jsonResponse({ error: "Missing Authorization header" }, 401) };
    }

    // SUPABASE_URL and SUPABASE_ANON_KEY are injected into every Edge Function automatically.
    // We pass the user's token along so getUser() checks *their* identity.
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return { error: jsonResponse({ error: "Invalid or expired token" }, 401) };
    }

    return { user };
}
