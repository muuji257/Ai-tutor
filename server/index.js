import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const tutorInstructions = `
You are Aha, a patient, excellent interactive tutor for a student.
Teach rather than merely dump answers. Explain one manageable idea at a time,
ask a useful check-for-understanding question, and adapt if the learner is confused.
The learner may use English, Hindi, or Hinglish. Reply in the language they use,
unless they explicitly request another language. Keep language clear and age-appropriate.
For schoolwork, respect the learner's stated curriculum and show steps.

Return ONLY valid JSON with this exact shape:
{
  "reply": "The spoken explanation in plain text. No markdown tables.",
  "board": [
    {"kind":"heading","content":"Short board heading"},
    {"kind":"text","content":"A concise explanation or step"},
    {"kind":"equation","content":"2x + 5 = 17"},
    {"kind":"equation","content":"2x = 12"},
    {"kind":"equation","content":"x = 6"}
  ],
  "checkQuestion": "One short question to check understanding, or an empty string"
}
Use 2-7 board items. Use equation for equations/formulas and text for explanations.
Do not invent diagrams that cannot be represented as text. Keep board content concise.
`;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(client) });
});

app.post("/api/tutor", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error: "The AI server is not configured yet. Add an API key to server/.env (with a parent/guardian's help), then restart the server."
      });
    }
    const { messages, language = "auto" } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Send at least one message." });
    }
    const safeMessages = messages.slice(-12).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? "").slice(0, 5000)
    }));
    const languageNote = language === "en" ? "Respond in English." :
      language === "hi" ? "Respond in Hindi using Devanagari script." :
      "Respond in the language or mix of languages used by the student (English, Hindi, or Hinglish).";

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-6.2-astra",
      instructions: `${tutorInstructions}\n${languageNote}`,
      input: safeMessages.map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content}`).join("\n\n")
    });

    const raw = response.output_text || "";
    let parsed;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reply: raw || "I couldn't form an explanation. Try asking in a different way.", board: [], checkQuestion: "" };
    }
    res.json({
      reply: String(parsed.reply || "Let's work through this together."),
      board: Array.isArray(parsed.board) ? parsed.board.slice(0, 10) : [],
      checkQuestion: String(parsed.checkQuestion || "")
    });
  } catch (error) {
    console.error("Tutor error:", error?.message || error);
    res.status(500).json({ error: "The tutor couldn't answer just now. Check the server logs and try again." });
  }
});

app.post("/api/speech", async (req, res) => {
  try {
    if (!client) return res.status(503).json({ error: "AI voice is not configured yet." });
    const { text, voice = "nova", language = "en" } = req.body ?? {};
    const input = String(text || "").trim().slice(0, 4000);
    if (!input) return res.status(400).json({ error: "Speech text is empty." });

    const allowedVoices = new Set(["nova", "coral", "shimmer", "onyx", "echo", "ash", "marin", "cedar"]);
    const selectedVoice = allowedVoices.has(voice) ? voice : "nova";
    const isHindi = language === "hi" || /[\\u0900-\\u097F]/.test(input);
    const speech = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: selectedVoice,
      input,
      instructions: isHindi
        ? "Speak clearly in Hindi, with a warm, patient teacher-like delivery."
        : "Speak clearly in English, with a warm, patient teacher-like delivery.",
      response_format: "mp3"
    });
    const buffer = Buffer.from(await speech.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    console.error("Speech error:", error?.message || error);
    res.status(500).json({ error: "Voice generation failed. You can still read the tutor's answer." });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Tutor API running on http://localhost:${port}`));
