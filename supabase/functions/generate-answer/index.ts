import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

const CHAT_MODEL = "gpt-4o";

// The "rules" GPT must follow. Each line guards against a specific failure:
// outside knowledge, invented answers, uncited claims, and fake quotes.
const SYSTEM_PROMPT = `You answer questions about General Conference talks from The Church of Jesus Christ of Latter-day Saints.

Rules:
- Use ONLY the talk excerpts provided. Do not add facts from outside knowledge.
- If the excerpts don't answer the question, say so plainly instead of guessing.
- Cite the talk title and speaker for each point you make.
- Only put text in quotation marks if it appears word-for-word in the excerpts.
- Be concise and warm: a few short paragraphs at most.`;

type ContextTalk = { title: string; speaker: string; text: string };

// AUGMENT: turn the retrieved talks into one block of text for the prompt
function buildContext(talks: ContextTalk[]): string {
    return talks
        .map((talk) => `"${talk.title}" by ${talk.speaker}:\n${talk.text}`)
        .join("\n\n---\n\n");
}

Deno.serve(async (req) => {
    // 1. CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // 2. Auth check first — GPT-4o calls cost far more than embeddings
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 3. Validate input
        const { question, context_talks } = await req.json();
        if (!question || typeof question !== "string") {
            return jsonResponse({ error: "Missing or invalid 'question' field" }, 400);
        }
        if (!Array.isArray(context_talks) || context_talks.length === 0) {
            return jsonResponse({ error: "Missing or invalid 'context_talks' field" }, 400);
        }

        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 4. GENERATE: system message = rules, user message = retrieved talks + question
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
                    {
                        role: "user",
                        content: `Talk excerpts:\n\n${buildContext(context_talks)}\n\n---\n\nQuestion: ${question}`,
                    },
                ],
                temperature: 0.3, // low = stick close to the sources
                max_tokens: 1024, // cap the answer length (and cost)
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return jsonResponse({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        // 5. Return the answer text
        const data = await response.json();
        return jsonResponse({ answer: data.choices[0].message.content });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 500);
    }
});
