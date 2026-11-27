
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

app.use(express.json({ limit: "1mb" }));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

const MODEL =
  process.env.OPENAI_MODEL || "gpt-6.2-astra";

const tutorInstructions = `
You are Aha, a patient and excellent interactive tutor.

Your job is to teach, not just give answers.

Teaching rules:
- Explain one manageable idea at a time.
- Use simple, age-appropriate language.
- Adapt explanations when the student is confused.
- Support English, Hindi and Hinglish.
- Follow the student's requested school curriculum.
- Show calculations step by step.
- Ask one useful question to check understanding.

Return ONLY valid JSON with this exact structure:

{
  "reply": "Your spoken explanation in plain text.",
  "board": [
    {
      "kind": "heading",
      "content": "Short topic heading"
    },
    {
      "kind": "text",
      "content": "A concise explanation"
    },
    {
      "kind": "equation",
      "content": "2x + 5 = 17"
    }
  ],
  "checkQuestion": "One short question or empty string"
}

Rules for the board:
- Use 2 to 7 board items.
- Allowed kinds: heading, text, equation.
- Keep explanations concise.
- Do not invent diagrams.
- No Markdown tables.
`;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(client),
    model: client ? MODEL : null
  });
});

// AI TUTOR
app.post("/api/tutor", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error:
          "AI is not configured. The server needs an API key."
      });
    }

    const {
      messages,
      language = "auto"
    } = req.body ?? {};

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return res.status(400).json({
        error: "Send at least one message."
      });
    }

    const safeMessages = messages
      .slice(-12)
      .map((message) => ({
        role:
          message.role === "assistant"
            ? "assistant"
            : "user",
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

    const response = await client.responses.create({
      model: MODEL,
      instructions:
        tutorInstructions + "\n" + languageNote,
      input: safeMessages
        .map((message) => {
          const role =
            message.role === "user"
              ? "STUDENT"
              : "TUTOR";

          return `${role}: ${message.content}`;
        })
        .join("\n\n")
    });

    const raw = response.output_text || "";

    let parsed;

    try {
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        reply:
          raw ||
          "I couldn't prepare an explanation. Please try again.",
        board: [],
        checkQuestion: ""
      };
    }

    res.json({
      reply: String(
        parsed.reply ||
        "Let's learn this together."
      ),

      board: Array.isArray(parsed.board)
        ? parsed.board.slice(0, 10)
        : [],

      checkQuestion: String(
        parsed.checkQuestion || ""
      )
    });

  } catch (error) {
    console.error(
      "Tutor error:",
      error?.message || error
    );

    res.status(500).json({
      error:
        "The tutor couldn't answer right now. Please try again."
    });
  }
});

// AI VOICE
app.post("/api/speech", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error: "AI voice is not configured."
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

    const selectedVoice =
      allowedVoices.has(voice)
        ? voice
        : "nova";

    // Correct Hindi Unicode detection
    const isHindi =
      language === "hi" ||
      /[\u0900-\u097F]/.test(input);

    const speech = await client.audio.speech.create({
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

    res.setHeader(
      "Content-Type",
      "audio/mpeg"
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.send(buffer);

  } catch (error) {
    console.error(
      "Speech error:",
      error?.message || error
    );

    res.status(500).json({
      error:
        "Voice generation failed. You can still read the tutor's answer."
    });
  }
});

// START SERVER
const PORT = Number(
  process.env.PORT || 8787
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Aha Tutor API running on port ${PORT}`
  );
});
    
