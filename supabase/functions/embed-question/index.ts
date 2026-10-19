import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

// Must match the model used in scripts/04_embed_data.py —
// embeddings from different models live in different "meaning spaces".
const EMBEDDING_MODEL = "text-embedding-3-small";

Deno.serve(async (req) => {
    // 1. CORS preflight: the browser asks "may I call you?" before the real request
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // 2. Only logged-in users may spend our OpenAI credits
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 3. Validate input
        const { question } = await req.json();
        if (!question || typeof question !== "string") {
            return jsonResponse({ error: "Missing or invalid 'question' field" }, 400);
        }

        // The secret lives in Supabase (set with `supabase secrets set`), never in the browser
        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 4. Ask OpenAI to embed the question
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: EMBEDDING_MODEL, input: question }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return jsonResponse({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        // 5. Return the 1,536-number vector
        const data = await response.json();
        return jsonResponse({ embedding: data.data[0].embedding });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 500);
    }
});
