
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

// GEMINI CONFIGURATION
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Keep OpenAI optional for the existing speech feature.
const speechClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

// COMMON GEMINI FUNCTION
async function askGemini(prompt, maxOutputTokens = 8192) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Gemini request failed."
    );
  }

  const raw = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("");

  if (!raw) {
    throw new Error("Gemini returned an empty response.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid JSON.");
  }
}

// HEALTH CHECK
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(GEMINI_API_KEY),
    provider: GEMINI_API_KEY ? "Google Gemini" : null,
    model: GEMINI_API_KEY ? GEMINI_MODEL : null
  });
});

// AI TUTOR
app.post("/api/tutor", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: "Gemini API key is not configured."
      });
    }

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
        content: String(message.content ?? "").slice(0, 5000)
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

    const result = await askGemini(prompt, 4096);

    res.json({
      reply: String(
        result.reply || "Let's learn this together."
      ),
      board: Array.isArray(result.board)
        ? result.board.slice(0, 10)
        : [],
      checkQuestion: String(result.checkQuestion || "")
    });

  } catch (error) {
    console.error("Tutor error:", error.message);

    res.status(500).json({
      error: error.message || "The tutor couldn't answer."
    });
  }
});

// GENERATE LESSON FROM PDF
app.post("/api/lesson", async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        error: "Gemini API key is not configured."
      });
    }

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

    // Limit request size to protect the free API quota.
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

    const lesson = await askGemini(prompt, 8192);

    res.json({
      success: true,
      lesson,
      truncated: wasTruncated,
      message: wasTruncated
        ? "Only the first 180,000 characters were sent. More document processing will be needed for complete coverage."
        : "Lesson generated successfully."
    });

  } catch (error) {
    console.error("Lesson generation error:", error.message);

    res.status(500).json({
      error:
        error.message || "Could not generate the lesson."
    });
  }
});

// EXISTING AI VOICE
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

// START SERVER
const PORT = Number(process.env.PORT || 8787);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aha Tutor API running on port ${PORT}`);
});
  
