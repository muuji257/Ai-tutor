
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || true
  })
);

app.use(express.json({ limit: "3mb" }));

// =====================================
// PROVIDER CONFIGURATION
// =====================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Groq is opt-in. Enable only after checking
// the account's free-tier and billing settings.
const GROQ_ENABLED =
  process.env.ENABLE_GROQ === "true";

const GROQ_MODEL =
  process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Optional OpenAI voice service.
// This is separate from the three text providers.
const speechClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
      maxRetries: 0
    })
  : null;

// OpenRouter client
const openRouterClient = OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      timeout: 25000,
      maxRetries: 0
    })
  : null;

// Groq client
const groqClient = GROQ_API_KEY && GROQ_ENABLED
  ? new OpenAI({
      apiKey: GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 25000,
      maxRetries: 0
    })
  : null;


// =====================================
// JSON RESPONSE PARSER
// =====================================

function parseAIJson(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("AI returned an empty response.");
  }

  let cleaned = raw.trim();

  // Remove Markdown code fences if present.
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try extracting the main JSON object.
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }

    throw new Error("AI returned invalid JSON.");
  }
}


// =====================================
// GEMINI PROVIDER
// =====================================

async function askGemini(prompt, maxOutputTokens) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key missing.");
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    25000
  );

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens,
            temperature: 0.5
          }
        })
      }
    );

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error("Gemini returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data.error?.message ||
        `Gemini request failed (${response.status}).`
      );
    }

    const raw = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

    return parseAIJson(raw);

  } finally {
    clearTimeout(timeout);
  }
}


// =====================================
// OPENAI-COMPATIBLE PROVIDERS
// =====================================

async function askCompatibleProvider(
  client,
  model,
  prompt,
  maxOutputTokens
) {
  const completion =
    await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: {
        type: "json_object"
      },
      max_tokens: maxOutputTokens,
      temperature: 0.5
    });

  const raw = completion.choices?.[0]?.message?.content;

  return parseAIJson(raw);
}


// =====================================
// AUTOMATIC AI FALLBACK ROUTER
// =====================================

async function askAI(prompt, maxOutputTokens = 4096) {
  const providers = [];

  if (GEMINI_API_KEY) {
    providers.push({
      name: "Gemini",
      run: () => askGemini(prompt, maxOutputTokens)
    });
  }

  if (openRouterClient) {
    providers.push({
      name: "OpenRouter",
      run: () =>
        askCompatibleProvider(
          openRouterClient,
          "openrouter/free",
          prompt,
          maxOutputTokens
        )
    });
  }

  if (groqClient) {
    providers.push({
      name: "Groq",
      run: () =>
        askCompatibleProvider(
          groqClient,
          GROQ_MODEL,
          prompt,
          maxOutputTokens
        )
    });
  }

  if (providers.length === 0) {
    throw new Error("No AI provider is configured.");
  }

  const errors = [];

  for (const provider of providers) {
    try {
      console.log(`Trying AI provider: ${provider.name}`);

      const result = await provider.run();

      console.log(`AI response received from ${provider.name}`);

      return {
        result,
        provider: provider.name
      };

    } catch (error) {
      const message = error?.message || "Unknown error";

      console.error(
        `${provider.name} failed: ${message}`
      );

      errors.push(`${provider.name}: ${message}`);
    }
  }

  console.error("All AI providers failed:", errors);

  throw new Error(
    "All configured AI providers are currently unavailable. Please try again shortly."
  );
}


// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (_req, res) => {
  const providers = {
    gemini: Boolean(GEMINI_API_KEY),
    openrouter: Boolean(openRouterClient),
    groq: Boolean(groqClient),
    groqKeyPresent: Boolean(GROQ_API_KEY),
    openaiVoice: Boolean(speechClient)
  };

  const configured =
    providers.gemini ||
    providers.openrouter ||
    providers.groq;

  res.json({
    ok: true,
    configured,
    provider: "Gemini → OpenRouter → Groq",
    model: GEMINI_MODEL,
    providers
  });
});


// =====================================
// AI TUTOR
// =====================================

app.post("/api/tutor", async (req, res) => {
  try {
    const {
      messages,
      language = "auto"
    } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Send at least one message."
      });
    }

    const safeMessages = messages
      .slice(-12)
      .map(message => ({
        role:
          message.role === "assistant"
            ? "TUTOR"
            : "STUDENT",
        content: String(
          message.content ?? ""
        ).slice(0, 5000)
      }));

    const languageNote =
      language === "en"
        ? "Respond in English."
        : language === "hi"
        ? "Respond in Hindi using Devanagari script."
        : "Respond in the language or mixture of languages used by the student.";

    const prompt = `
You are Aha, a patient and excellent interactive tutor.

Teach the student, do not just give answers.

RULES:
- Explain one manageable idea at a time.
- Use simple, age-appropriate language.
- Adapt explanations when the student is confused.
- Support English, Hindi and Hinglish.
- Follow the student's requested school curriculum.
- Show calculations step by step.
- Ask one useful question to check understanding.
- ${languageNote}

Return ONLY valid JSON:

{
  "reply": "Your spoken explanation.",
  "board": [
    {
      "kind": "heading",
      "content": "Topic heading"
    },
    {
      "kind": "text",
      "content": "Explanation"
    },
    {
      "kind": "equation",
      "content": "An equation if needed"
    }
  ],
  "checkQuestion": "One short question or empty string"
}

Board rules:
- Use 2 to 7 board items.
- Allowed kinds: heading, text, equation.
- Keep explanations concise.
- Do not invent diagrams.
- No Markdown tables.

CONVERSATION:

${safeMessages
  .map(message => `${message.role}: ${message.content}`)
  .join("\n\n")}
`;

    const { result, provider } = await askAI(
      prompt,
      4096
    );

    res.json({
      reply: String(
        result.reply || "Let's learn this together."
      ),
      board: Array.isArray(result.board)
        ? result.board.slice(0, 10)
        : [],
      checkQuestion: String(
        result.checkQuestion || ""
      ),
      provider
    });

  } catch (error) {
    console.error("Tutor error:", error.message);

    res.status(503).json({
      error: error.message
    });
  }
});


// =====================================
// GENERATE LESSON FROM PDF
// =====================================

app.post("/api/lesson", async (req, res) => {
  try {
    const {
      text,
      name = "Uploaded PDF",
      language = "auto"
    } = req.body ?? {};

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "No PDF text was provided."
      });
    }

    if (text.length < 50) {
      return res.status(400).json({
        error: "The PDF does not contain enough readable text."
      });
    }

    const sourceText = text.slice(0, 180000);
    const wasTruncated = text.length > sourceText.length;

    const languageNote =
      language === "en"
        ? "Write the lesson in English."
        : language === "hi"
        ? "Write the lesson in Hindi using Devanagari."
        : "Use the language most appropriate for the uploaded material and student's language.";

    const prompt = `
You are Aha, an expert school teacher.

Create a complete, well-organized study lesson using the PDF text below.

DOCUMENT: ${name}

IMPORTANT RULES:
- ${languageNote}
- Use the uploaded document as your primary source.
- Cover all major topics and subtopics present in the supplied text.
- Do not invent facts or definitions.
- Explain difficult concepts in simple language.
- Preserve important formulas, definitions, dates and keywords.
- Include useful examples where appropriate.
- Organize the content into logical sections.
- Make the lesson useful for school examination preparation.
- Do not claim to cover text that is missing.
- If the supplied text ends abruptly, mention that limitation.

Return ONLY valid JSON with this structure:

{
  "title": "Lesson title",
  "overview": "Short introduction to the document",
  "sections": [
    {
      "heading": "Topic heading",
      "explanation": "Clear and detailed explanation",
      "keyPoints": [
        "Important point",
        "Another important point"
      ]
    }
  ],
  "importantTerms": [
    {
      "term": "Important term",
      "meaning": "Simple definition"
    }
  ],
  "revisionNotes": [
    "Important revision note"
  ],
  "quiz": [
    {
      "question": "Question",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "Correct option",
      "explanation": "Why this answer is correct"
    }
  ]
}

Create a useful lesson, not a short summary.
Aim for 5 to 10 sections when the document supports it.
Include 5 to 10 quiz questions when appropriate.

PDF TEXT:

${sourceText}
`;

    const { result: lesson, provider } = await askAI(
      prompt,
      8192
    );

    res.json({
      success: true,
      lesson,
      provider,
      truncated: wasTruncated,
      message: wasTruncated
        ? "Only the first 180,000 characters were sent. More document processing will be needed for complete coverage."
        : "Lesson generated successfully."
    });

  } catch (error) {
    console.error(
      "Lesson generation error:",
      error.message
    );

    res.status(503).json({
      error: error.message
    });
  }
});


// =====================================
// EXISTING OPENAI VOICE
// =====================================

app.post("/api/speech", async (req, res) => {
  try {
    if (!speechClient) {
      return res.status(503).json({
        error: "The existing OpenAI voice service is not configured."
      });
    }

    const {
      text,
      voice = "nova",
      language = "en"
    } = req.body ?? {};

    const input = String(text || "")
      .trim()
      .slice(0, 4000);

    if (!input) {
      return res.status(400).json({
        error: "Speech text is empty."
      });
    }

    const allowedVoices = new Set([
      "nova",
      "coral",
      "shimmer",
      "onyx",
      "echo",
      "ash",
      "marin",
      "cedar"
    ]);

    const selectedVoice = allowedVoices.has(voice)
      ? voice
      : "nova";

    const isHindi =
      language === "hi" ||
      /[\u0900-\u097F]/.test(input);

    const speech = await speechClient.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: selectedVoice,
      input,
      instructions: isHindi
        ? "Speak clearly in Hindi with a warm, patient teacher-like delivery."
        : "Speak clearly in English with a warm, patient teacher-like delivery.",
      response_format: "mp3"
    });

    const buffer = Buffer.from(
      await speech.arrayBuffer()
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    res.send(buffer);

  } catch (error) {
    console.error("Speech error:", error.message);

    res.status(500).json({
      error: "Voice generation failed."
    });
  }
});


// =====================================
// START SERVER
// =====================================

const PORT = Number(process.env.PORT || 8787);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aha Tutor API running on port ${PORT}`);
});
                                      
