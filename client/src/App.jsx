import React, { useEffect, useRef, useState } from "react";
import { AudioLines, BookOpen, Brain, ChevronDown, CircleHelp, Eraser, Languages, Mic, MicOff, Pause, Play, Plus, Send, Sparkles, Square, Volume2, X } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8787";
const starter = {
  role: "assistant",
  content: "Hi! I'm Aha, your AI tutor. Tell me what you're learning, paste a question, or ask me to explain something in a simpler way.",
  board: [{ kind: "heading", content: "Your learning space" }, { kind: "text", content: "Ask a question to start your first lesson." }]
};

export default function App() {
  const [messages, setMessages] = useState([starter]);
  const [board, setBoard] = useState(starter.board);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [voice, setVoice] = useState("nova");
  const [voiceMenu, setVoiceMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("Ready when you are");
  const [checkQuestion, setCheckQuestion] = useState("");
  const [apiReady, setApiReady] = useState(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/health`).then(r => r.json()).then(d => setApiReady(d.configured)).catch(() => setApiReady(false));
    return () => {
      recognitionRef.current?.stop();
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function speak(text) {
    stopSpeaking();
    setSpeaking(true);
    setStatus("Preparing voice…");
    try {
      const response = await fetch(`${API}/api/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, language: language === "hi" ? "hi" : "en" })
      });
      if (!response.ok) throw new Error("Voice API unavailable");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setSpeaking(false);
        setStatus("Ready when you are");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setSpeaking(false);
        setStatus("Voice playback failed");
      };
      await audio.play();
      setStatus("Tutor is speaking · tap interrupt anytime");
    } catch {
      setSpeaking(false);
      setStatus("Voice unavailable · showing text instead");
    }
  }

  async function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    stopListening();
    stopSpeaking();
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setStatus("Thinking through the lesson…");
    try {
      const response = await fetch(`${API}/api/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          language
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Tutor request failed");
      const answer = { role: "assistant", content: data.reply, board: data.board || [] };
      setMessages(prev => [...prev, answer]);
      setBoard(data.board || []);
      setCheckQuestion(data.checkQuestion || "");
      setStatus("Explanation ready");
      // Natural voice is opt-in per answer so the phone doesn't unexpectedly speak.
    } catch (error) {
      setMessages(prev => [...prev, { role: "assistant", content: `I couldn't connect: ${error.message}` }]);
      setStatus("Connection problem");
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    stopSpeaking();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus("Speech recognition isn't supported in this browser. You can type instead.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = language === "hi" ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    let finalText = "";
    recognition.onstart = () => { setListening(true); setStatus("Listening…"); };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      setDraft((finalText + " " + interim).trim());
    };
    recognition.onerror = () => { setListening(false); setStatus("Mic unavailable. Try typing."); };
    recognition.onend = () => {
      setListening(false);
      setStatus("Ready when you are");
      if (finalText.trim()) setDraft(finalText.trim());
    };
    recognition.start();
  }

  const lastAnswer = [...messages].reverse().find(m => m.role === "assistant" && m !== starter);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div><span>aha<span className="brand-light">board</span></span><span className="beta">YOUR STUDY SPACE</span></div>
        <div className="top-actions">
          <div className="status-pill"><span className={`status-dot ${apiReady ? "online" : ""}`}></span>{apiReady === null ? "Checking" : apiReady ? "AI connected" : "Setup needed"}</div>
          <button className="icon-button" title="New lesson" onClick={() => { stopSpeaking(); setMessages([starter]); setBoard(starter.board); setCheckQuestion(""); }}><Plus size={18}/></button>
        </div>
      </header>

      <main className="workspace">
        <section className="lesson-column">
          <div className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line"></span> YOUR PERSONAL AI TUTOR</div><h1>Let's make it <em>click.</em></h1><p className="subhead">Ask anything. Work it through. See every step.</p></div>
            <div className="brain-orb"><div className="orb-core"><Brain size={26}/></div><span className="orb-ring ring-one"></span><span className="orb-ring ring-two"></span></div>
          </div>

          <div className="board-card">
            <div className="board-header">
              <div className="board-title"><div className="board-icon"><BookOpen size={16}/></div><div><strong>Learning board</strong><small>LIVE EXPLANATION</small></div></div>
              <div className="board-tools"><span className="live-tag"><span></span> BOARD</span><button className="tiny-icon" onClick={() => setBoard([])} title="Clear board"><Eraser size={15}/></button></div>
            </div>
            <div className="board-canvas">
              <div className="grid-glow"></div>
              {board.length ? <div className="board-content">{board.map((item, i) => (
                <div className={`board-item ${item.kind || "text"}`} key={i}>
                  {item.kind === "heading" ? <h2>{item.content}</h2> : item.kind === "equation" ? <div className="equation">{item.content}</div> : <p>{item.content}</p>}
                </div>
              ))}</div> : <div className="empty-board"><div className="empty-doodle">∑</div><strong>Your board is ready</strong><span>Steps, equations and explanations will appear here.</span></div>}
              {busy && <div className="board-thinking"><span className="thinking-dot"></span> Planning the next explanation…</div>}
            </div>
            <div className="board-footer"><span><span className="footer-dot"></span> Updates as your tutor teaches</span><span>AI-generated · Check important work</span></div>
          </div>

          <div className="mode-row">
            <div className="mode-chip active"><Sparkles size={14}/> Learn a topic</div>
            <div className="mode-chip"><CircleHelp size={14}/> Homework help</div>
            <div className="mode-chip"><BookOpen size={14}/> Exam prep</div>
          </div>
        </section>

        <section className="tutor-column">
          <div className="tutor-card">
            <div className="tutor-header">
              <div className="tutor-avatar"><Sparkles size={18}/><span></span></div>
              <div className="tutor-heading"><strong>Your tutor</strong><small><span className="online-dot"></span> Patient, curious, always ready</small></div>
              <button className="more-button" onClick={() => setVoiceMenu(v => !v)}><AudioLines size={17}/><ChevronDown size={13}/></button>
            </div>
            {voiceMenu && <div className="voice-panel"><div className="panel-label">TUTOR VOICE <span>AI-GENERATED</span></div><div className="voice-options">
              <button className={voice === "nova" ? "selected" : ""} onClick={() => { setVoice("nova"); setVoiceMenu(false); }}>Higher voice · Nova</button>
              <button className={voice === "onyx" ? "selected" : ""} onClick={() => { setVoice("onyx"); setVoiceMenu(false); }}>Lower voice · Onyx</button>
            </div><div className="panel-label language-label">LESSON LANGUAGE</div><select value={language} onChange={e => setLanguage(e.target.value)}><option value="auto">Auto · English / Hindi / Hinglish</option><option value="en">English</option><option value="hi">Hindi</option></select></div>}
            <div className="chat-scroll">
              <div className="date-divider"><span>YOUR LESSON</span></div>
              {messages.map((m, i) => <div className={`message-row ${m.role}`} key={i}>
                {m.role === "assistant" && <div className="mini-avatar"><Sparkles size={13}/></div>}
                <div className="message-bubble">
                  <div className="message-text">{m.content}</div>
                  {m.role === "assistant" && i > 0 && <div className="message-actions"><button onClick={() => speak(m.content)}><Play size={12}/> Listen</button><button onClick={stopSpeaking}><Square size={11}/> Stop</button></div>}
                </div>
              </div>)}
              {busy && <div className="message-row assistant"><div className="mini-avatar"><Sparkles size={13}/></div><div className="typing-bubble"><i></i><i></i><i></i></div></div>}
              <div ref={messagesEndRef}/>
            </div>
            {checkQuestion && <button className="check-question" onClick={() => { setDraft(checkQuestion); }}>{checkQuestion}<span>Try answering ↗</span></button>}
            <div className="composer-wrap">
              <div className="composer">
                <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Ask your tutor anything…" rows={2}/>
                <div className="composer-bottom">
                  <div className="composer-tools"><button className={`mic-button ${listening ? "recording" : ""}`} onClick={listening ? stopListening : startListening} title={listening ? "Stop listening" : "Speak"}>{listening ? <MicOff size={17}/> : <Mic size={17}/>}</button><span>{listening ? "Listening" : "Voice input"}</span></div>
                  <button className="send-button" disabled={busy || !draft.trim()} onClick={() => sendMessage()}><Send size={15}/><span>Send</span></button>
                </div>
              </div>
              <div className="composer-note"><span>{status}</span><span>Enter to send · Shift + Enter for new line</span></div>
            </div>
          </div>
          <div className="tip-card"><div className="tip-icon"><Volume2 size={16}/></div><div><strong>Cut in whenever you like</strong><p>Tap Stop while the tutor is speaking, then ask a follow-up in your own words.</p></div></div>
          <div className="disclosure">Voice is AI-generated. Mic access is used only when you tap the microphone. Avoid sharing private information.</div>
        </section>
      </main>
      <footer className="footer"><span>aha<span>board</span> · independent learning project</span><span>Built for curious minds <span className="footer-star">✳</span></span></footer>
    </div>
  );
}
