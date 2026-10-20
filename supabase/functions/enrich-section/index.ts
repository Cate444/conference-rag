import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth.ts";

const CHAT_MODEL = "gpt-4o";

// Adds conference-talk evidence to ONE section of the user's talk.
// Returns JSON so the browser knows exactly which quotes were inserted
// (it verifies them and protects them during the polish step).
const SYSTEM_PROMPT = `You help a member of The Church of Jesus Christ of Latter-day Saints strengthen a section of a talk they are writing, using evidence from General Conference talks.

You will receive the author's section and excerpts from 1-2 conference talks.

Rules:
- Keep the author's ideas, wording, voice, and personal stories. Do not rewrite their message — add to it.
- Add 1-2 short supporting quotes (one or two sentences each) from the excerpts, woven naturally into the section.
- Introduce each quote with the speaker and talk title, e.g. As Elder Name taught in "Talk Title," "...quote..."
- Every quote must be copied EXACTLY, character for character, from the excerpts. Never paraphrase inside quotation marks.
- Do not add facts, stories, or scriptures that are not in the author's section or the excerpts.
- If nothing in the excerpts genuinely supports the section, return the section unchanged with an empty quotes list.

Respond with JSON only, in this shape:
{"paragraph": "<the enriched section>", "quotes": [{"text": "<exact quoted words, without quotation marks>", "talk_title": "<title>"}]}`;

type ContextTalk = { title: string; speaker: string; text: string };

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

    // 2. Auth check before any OpenAI spending
    const auth = await requireAuth(req);
    if ("error" in auth) return auth.error;

    try {
        // 3. Validate input
        const { section, context_talks } = await req.json();
        if (!section || typeof section !== "string") {
            return jsonResponse({ error: "Missing or invalid 'section' field" }, 400);
        }
        if (!Array.isArray(context_talks) || context_talks.length === 0) {
            return jsonResponse({ error: "Missing or invalid 'context_talks' field" }, 400);
        }

        const openaiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiKey) {
            return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
        }

        // 4. Ask GPT for the enriched section, as JSON
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
                        content: `Talk excerpts:\n\n${buildContext(context_talks)}\n\n---\n\nAuthor's section:\n${section}`,
                    },
                ],
                response_format: { type: "json_object" }, // guarantees parseable JSON
                temperature: 0.3,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return jsonResponse({ error: err.error?.message || "OpenAI API error" }, response.status);
        }

        // 5. Parse and return { paragraph, quotes }
        const data = await response.json();
        const result = JSON.parse(data.choices[0].message.content);
        return jsonResponse({
            paragraph: typeof result.paragraph === "string" ? result.paragraph : section,
            quotes: Array.isArray(result.quotes) ? result.quotes : [],
        });
    } catch (err) {
        return jsonResponse({ error: (err as Error).message }, 500);
    }
});
