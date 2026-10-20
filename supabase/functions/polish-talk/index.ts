import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

const CHAT_MODEL = "gpt-4o";

// Final pass for flow. The browser has already swapped every quote for a
// placeholder like ⟦Q1⟧, so GPT can't alter quoted words — it never sees them.
const SYSTEM_PROMPT = `You are editing a talk that a member of The Church of Jesus Christ of Latter-day Saints will give in church.

Your job is a light final polish:
- Smooth transitions between sections so the talk flows as one cohesive message.
- Fix grammar and awkward phrasing.
- Keep the author's voice, ideas, personal stories, and paragraph structure. Do not add new content, facts, or quotes.
- The talk contains placeholders like ⟦Q1⟧, ⟦Q2⟧. Each stands for a quotation. Keep EVERY placeholder exactly as written, in the same sentence, with the attribution around it. Never remove, merge, reorder, or rewrite a placeholder.

Return only the polished talk text.`;

const PLACEHOLDER = /⟦Q\d+⟧/g;

Deno.serve(async (req) => {
    // 1. CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // 2. Auth check before any OpenAI spending
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 3. Validate input
        const { draft } = await req.json();
        if (!draft || typeof draft !== "string") {
            return jsonResponse({ error: "Missing or invalid 'draft' field" }, 400);
        }

        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 4. Ask GPT to polish the placeholder version of the draft
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: CHAT_MODEL,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: draft },
                ],
                temperature: 0.4,
                max_tokens: 3000,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return jsonResponse({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        const data = await response.json();
        const polished: string = data.choices[0].message.content;

        // 5. Don't trust, verify: report any placeholder GPT dropped
        const kept = new Set(polished.match(PLACEHOLDER) ?? []);
        const missing = (draft.match(PLACEHOLDER) ?? []).filter((p) => !kept.has(p));

        return jsonResponse({ talk: polished, missing_placeholders: missing });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 500);
    }
});
