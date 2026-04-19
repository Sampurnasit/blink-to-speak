import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBlinkDetector, BlinkEvent } from "@/hooks/useBlinkDetector";
import { decodeMorse, predictWords } from "@/lib/morse";
import { speak } from "@/lib/speech";

const MORSE_CHART: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--.."
};

const QUICK_WORDS = [
  { label: "Yes", emoji: "✅" },
  { label: "No", emoji: "❌" },
  { label: "Help", emoji: "🆘" },
  { label: "Water", emoji: "💧" },
  { label: "Pain", emoji: "😣" },
  { label: "Doctor", emoji: "👨‍⚕️" },
  { label: "Please", emoji: "🙏" },
  { label: "Thank you", emoji: "🙌" },
  { label: "Need", emoji: "❗" },
  { label: "I", emoji: "👤" },
  { label: "Food", emoji: "🍽️" },
  { label: "Tired", emoji: "😴" },
];

const YOUTUBE_LINKS = [
  { label: "Relaxing Music", q: "relaxing music", emoji: "🎵", videoId: "lFcSrYw-ARY" },
  { label: "Meditation", q: "meditation", emoji: "🧘", videoId: "inpok4MKVLM" },
  { label: "Bhajans", q: "bhajans", emoji: "🙏", videoId: "UHkEH1FY7WA" },
  { label: "Nature Sounds", q: "nature sounds", emoji: "🌿", videoId: "eKFTSSKCzWA" },
];

const DEFAULT_CONTACTS = [
  { label: "Mom", phone: "919876543210", emoji: "👩" },
  { label: "Dad", phone: "919876543211", emoji: "👨" },
  { label: "Doctor", phone: "919876543212", emoji: "👨‍⚕️" },
  { label: "Nurse", phone: "919876543213", emoji: "👩‍⚕️" },
];

function loadContacts() {
  try {
    const saved = localStorage.getItem("blink_contacts");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_CONTACTS;
}

function saveContacts(contacts: typeof DEFAULT_CONTACTS) {
  localStorage.setItem("blink_contacts", JSON.stringify(contacts));
}

// Free API instances to try in order for custom video search
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
];

function formatTime() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

const Index = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [morse, setMorse] = useState("");
  const [text, setText] = useState("");
  const [sensitivity, setSensitivity] = useState(0.23);
  const [split, setSplit] = useState(300);
  const [gap, setGap] = useState(800);

  const [debug, setDebug] = useState(false);
  const [logs, setLogs] = useState<{ id: string; time: string; msg: string; kind: string }[]>([]);
  const [youtubeSearch, setYoutubeSearch] = useState("");
  const [contacts, setContacts] = useState(loadContacts);
  const [editingContacts, setEditingContacts] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [sendMode, setSendMode] = useState<"whatsapp" | "sms">(
    () => (localStorage.getItem("blink_sendmode") as "whatsapp" | "sms") || "whatsapp"
  );

  const CATEGORIES = useMemo(() => [
    { id: "quick_words", items: QUICK_WORDS.map(w => ({ ...w, type: "word" })) },
    {
      id: "youtube", items: [
        { type: "youtube_search_text", label: "YT: Typed Text", emoji: "🔍" },
        ...YOUTUBE_LINKS.map(w => ({ ...w, type: "youtube" }))
      ]
    },
    {
      id: "messaging", items: contacts.map((c: typeof DEFAULT_CONTACTS[0]) => ({ ...c, type: "message" }))
    }
  ], [contacts]);

  const addLog = useCallback((msg: string, kind: string) => {
    setLogs(prev => {
      const n = [{ id: crypto.randomUUID(), time: formatTime(), msg, kind }, ...prev];
      return n.slice(0, 15);
    });
  }, []);

  const handleYouTubeSearch = useCallback(async (query?: string) => {
    const raw = (query || youtubeSearch || text).trim();
    if (!raw) return;

    speak(`Playing ${query || "video"}`);
    addLog(`YOUTUBE: ${raw}`, "red");

    // Check if this matches a preset with a hardcoded videoId
    const preset = YOUTUBE_LINKS.find(
      v => v.q.toLowerCase() === raw.toLowerCase() || v.label.toLowerCase() === raw.toLowerCase()
    );
    if (preset?.videoId) {
      addLog(`AUTOPLAY: ${preset.label}`, "green");
      window.open(
        `https://www.youtube.com/watch?v=${preset.videoId}&autoplay=1`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    // For custom searches: try free APIs to get first video ID
    const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(raw)}`;

    for (const instance of PIPED_INSTANCES) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(
          `${instance}/search?q=${encodeURIComponent(raw)}&filter=videos`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!res.ok) continue;
        const data = await res.json();
        const firstVideo = data?.items?.[0];
        if (firstVideo?.url) {
          const videoId = firstVideo.url.replace("/watch?v=", "");
          addLog(`AUTOPLAY: ${videoId}`, "green");
          window.open(
            `https://www.youtube.com/watch?v=${videoId}&autoplay=1`,
            "_blank",
            "noopener,noreferrer"
          );
          return;
        }
      } catch {
        // try next instance
      }
    }

    // Final fallback: open YouTube search results page
    addLog("FALLBACK: Opening search page", "orange");
    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  }, [youtubeSearch, text, addLog]);

  const handleSendMessage = useCallback(async (contact: { label: string; phone: string }) => {
    const message = text.trim();
    if (!message) {
      speak("No message to send");
      addLog("NO MESSAGE", "red");
      return;
    }

    if (sendMode === "sms") {
      speak(`Sending SMS to ${contact.label}`);
      addLog(`SMS → ${contact.label}...`, "orange");

      const smsKey = localStorage.getItem("blink_sms_key") || "";
      if (!smsKey) {
        speak("No SMS API key configured");
        addLog("SMS FAILED: Set Fast2SMS API key in EDIT mode", "red");
        return;
      }

      try {
        // Fast2SMS needs bare 10-digit Indian number (no +, no 91 prefix)
        let number = contact.phone.replace(/[\s+\-]/g, "");
        if (number.startsWith("91") && number.length > 10) number = number.slice(2);
        const params = new URLSearchParams({
          authorization: smsKey,
          route: "q",
          message: `[BLINK] ${message}`,
          numbers: number,
        });
        const res = await fetch(`/api/fast2sms?${params.toString()}`);
        const data = await res.json();
        if (data.return === true) {
          speak("Message sent successfully");
          addLog(`SMS SENT ✓ ${contact.label}`, "green");
        } else {
          speak("SMS failed");
          addLog(`SMS FAILED: ${JSON.stringify(data.message || data.status_code || data)}`, "red");
        }
      } catch (err) {
        speak("SMS failed");
        addLog(`SMS ERROR: ${err instanceof Error ? err.message : "Network failure"}`, "red");
      }
    } else {
      // WhatsApp URI scheme
      const encoded = encodeURIComponent(message);
      const url = `https://wa.me/${contact.phone}?text=${encoded}`;
      speak(`Sending to ${contact.label}`);
      addLog(`WA → ${contact.label}: "${message}"`, "green");
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [text, addLog, sendMode]);

  // SOS state
  const [sosActive, setSosActive] = useState(false);
  const sosTimerRef = useRef<number | null>(null);

  // AAC Scanning state
  const [scanMode, setScanMode] = useState<"idle" | "category" | "item">("idle");
  const [scanCategoryIndex, setScanCategoryIndex] = useState(0);
  const [scanItemIndex, setScanItemIndex] = useState(0);
  const scanIntervalRef = useRef<number | null>(null);
  const scanModeRef = useRef<"idle" | "category" | "item">("idle");
  const scanCategoryRef = useRef(0);
  const scanItemRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { scanModeRef.current = scanMode; }, [scanMode]);
  useEffect(() => { scanCategoryRef.current = scanCategoryIndex; }, [scanCategoryIndex]);
  useEffect(() => { scanItemRef.current = scanItemIndex; }, [scanItemIndex]);



  // ── SOS ──────────────────────────────────────────────────────────────────
  const triggerEmergency = useCallback(() => {
    setSosActive(true);
    speak("Emergency! I need help immediately!");
    addLog("⚠ EMERGENCY SOS TRIGGERED", "red");
    if (sosTimerRef.current) window.clearTimeout(sosTimerRef.current);
    sosTimerRef.current = window.setTimeout(() => {
      setSosActive(false);
    }, 6000);
  }, [addLog]);

  const dismissSOS = useCallback(() => {
    setSosActive(false);
    if (sosTimerRef.current) window.clearTimeout(sosTimerRef.current);
  }, []);

  // ── Morse ─────────────────────────────────────────────────────────────────
  const commitMorse = useCallback(() => {
    setMorse(current => {
      if (!current) return current;
      const decoded = decodeMorse(current);
      if (decoded) setText(t => t + decoded);
      setLogs([]);
      return "";
    });
  }, []);

  const confirmTimerRef = useRef<number | null>(null);
  const scheduleConfirm = useCallback(() => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => commitMorse(), gap);
  }, [commitMorse, gap]);

  const addSymbol = useCallback(
    (s: "." | "-") => {
      addLog(s === "." ? "DOT  ·" : "DASH —", s === "." ? "cyan" : "purple");
      setMorse(m => m + s);
      scheduleConfirm();
    },
    [scheduleConfirm, addLog]
  );

  // ── AAC Scanning ──────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    setScanMode("category");
    setScanCategoryIndex(0);
    setScanItemIndex(0);
    addLog("SCANNING CATEGORIES", "orange");

    if (scanIntervalRef.current) window.clearInterval(scanIntervalRef.current);
    scanIntervalRef.current = window.setInterval(() => {
      if (scanModeRef.current === "category") {
        setScanCategoryIndex(prev => (prev + 1) % CATEGORIES.length);
      } else if (scanModeRef.current === "item") {
        const items = CATEGORIES[scanCategoryRef.current].items;
        setScanItemIndex(prev => (prev + 1) % items.length);
      }
    }, 1400);
  }, [addLog]);

  const stopScan = useCallback(() => {
    setScanMode("idle");
    setScanCategoryIndex(0);
    setScanItemIndex(0);
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  // ── Speak / handle blink ──────────────────────────────────────────────────
  const handleSpeak = useCallback(() => {
    if (morse) commitMorse();
    const message = text.trim();
    if (message) {
      speak(message);
      addLog("SPEAK ▶", "orange");
    } else {
      startScan();
    }
  }, [morse, commitMorse, text, addLog, startScan]);

  const handleBlink = useCallback(
    (e: BlinkEvent) => {
      // Scan mode: any blink selects
      if (scanModeRef.current !== "idle") {
        if (scanModeRef.current === "category") {
          setScanMode("item");
          setScanItemIndex(0);
          const catNames = ["Words", "Youtube", "Messaging"];
          const catName = catNames[scanCategoryRef.current] || "Unknown";
          speak(catName);
          addLog(`CATEGORY: ${catName}`, "green");
          if (scanIntervalRef.current) window.clearInterval(scanIntervalRef.current);
          scanIntervalRef.current = window.setInterval(() => {
            if (scanModeRef.current === "item") {
              const items = CATEGORIES[scanCategoryRef.current].items;
              setScanItemIndex(prev => (prev + 1) % items.length);
            }
          }, 1400);
          return;
        }

        if (scanModeRef.current === "item") {
          const cat = CATEGORIES[scanCategoryRef.current];
          const item = cat.items[scanItemRef.current];
          if (item) {
            if (item.type === "youtube") {
              handleYouTubeSearch((item as {q?: string}).q);
            } else if (item.type === "youtube_search_text") {
              handleYouTubeSearch();
            } else if (item.type === "message") {
              handleSendMessage(item as {label: string; phone: string});
            } else {
              speak(item.label);
              setText(t => (t.trim() ? t.trim() + " " : "") + item.label + " ");
              addLog(`SELECTED: ${item.label}`, "green");
            }
          }
          stopScan();
          return;
        }
      }

      // Double blink = backspace
      if (e.type === "double") {
        addLog("BACKSPACE ⌫", "red");
        setMorse(m => {
          if (m.length > 0) return m.slice(0, -1);
          setText(t => t.slice(0, -1));
          return m;
        });
        return;
      }

      if (e.type === "long") return addSymbol("-");
      addSymbol(".");
    },
    [addSymbol, stopScan, addLog, handleYouTubeSearch, handleSendMessage, CATEGORIES]
  );

  // ── Keyboard fallback ────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Don't intercept keys when user is typing in an input field
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "5") { e.preventDefault(); addSymbol("."); }
      if (e.key === "1") { e.preventDefault(); addSymbol("-"); }
      if (e.key === "Enter") { e.preventDefault(); commitMorse(); }
      if (e.key === " ") { e.preventDefault(); handleSpeak(); }
      if (e.key === "Escape") { e.preventDefault(); dismissSOS(); stopScan(); }
      if (e.key === "Backspace") {
        e.preventDefault();
        addLog("BACKSPACE ⌫", "red");
        setMorse(m => {
          if (m.length > 0) return m.slice(0, -1);
          setText(t => t.slice(0, -1));
          return m;
        });
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [addSymbol, commitMorse, handleSpeak, addLog, dismissSOS, stopScan]);

  // ── Detector ──────────────────────────────────────────────────────────────
  const detector = useBlinkDetector({
    videoRef,
    onBlink: handleBlink,
    onScan: startScan,
    onEmergency: triggerEmergency,
    enabled: true,
    sensitivity,
    splitMs: split,
  });

  const handleClear = () => { setText(""); setMorse(""); setLogs([]); };

  const currentPrefix = useMemo(() => {
    const parts = text.split(" ");
    return parts[parts.length - 1] ?? "";
  }, [text]);

  const predictions = useMemo(() => predictWords(currentPrefix, 4), [currentPrefix]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#080b13] text-[#e2e8f0] overflow-hidden select-none p-3 gap-4">

      {/* ── SOS OVERLAY ── */}
      {sosActive && (
        <div
          className="fixed inset-0 z-[2000] flex flex-col items-center justify-center cursor-pointer"
          style={{ background: "rgba(220,38,38,0.95)" }}
          onClick={dismissSOS}
        >
          {/* Pulsing ring */}
          <div className="absolute w-80 h-80 rounded-full border-8 border-white/30 animate-ping" />
          <div className="absolute w-64 h-64 rounded-full border-4 border-white/50 animate-pulse" />

          <div
            className="text-white font-black tracking-widest text-center z-10 select-none"
            style={{ fontSize: "clamp(5rem, 18vw, 14rem)", textShadow: "0 0 60px rgba(255,255,255,0.8), 0 0 120px rgba(255,0,0,1)" }}
          >
            SOS
          </div>
          <div className="text-white/90 text-2xl sm:text-4xl text-center font-bold uppercase mt-4 z-10 tracking-widest"
            style={{ textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>
            Emergency Requested<br />
            <span className="text-base sm:text-xl font-normal opacity-80 tracking-widest mt-2 block">Help is being alerted</span>
          </div>
          <div className="mt-10 px-6 py-3 border-2 border-white/60 text-white text-sm tracking-widest rounded z-10 hover:bg-white/10">
            BLINK OR CLICK TO DISMISS
          </div>
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-[320px] flex flex-col gap-4">

        {/* Logo */}
        <div className="flex items-center gap-2 pl-2 tracking-widest text-[#00f0ff] uppercase text-sm mt-1">
          <div className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse" />
          <span className="font-bold text-lg">BLINK</span>
          <Link to="/cube" className="ml-2 text-[9px] text-[#7c4dff] border border-[#7c4dff]/30 px-2 py-0.5 rounded hover:bg-[#7c4dff]/10 transition-colors">🧊 3D CUBE</Link>
          <span className="ml-auto text-[9px] text-gray-500">AAC v2</span>
        </div>

        {/* Camera */}
        <div className="relative aspect-[4/3] bg-black rounded-lg border border-[#1e293b] overflow-hidden flex-shrink-0">
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-[#166534] text-xs text-[#4ade80] rounded font-bold border border-[#4ade80]/30 z-10 flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-[#4ade80] rounded-full animate-pulse" />
            LIVE
          </div>
          <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none" />

          {debug && (
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-black/20 z-20 flex items-end border-t border-[#1e293b]/50">
              <div className="absolute top-2 left-2 text-[9px] text-[#00f0ff] tracking-widest font-bold z-30">
                EAR: {detector.currentEAR.toFixed(3)}<br />THR: {detector.threshold?.toFixed(3)}
              </div>
              <div className="absolute top-2 right-2 flex items-center gap-2 z-30">
                <span className="text-[8px] text-gray-400">BLINK</span>
                <div className={`w-3 h-3 rounded-full transition-colors ${detector.isClosed ? "bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]" : "border border-[#1e293b]"}`} />
              </div>
              <div className="w-full relative h-full">
                <div className="absolute bottom-0 w-full bg-[#00f0ff]/30 transition-all duration-75" style={{ height: `${Math.min(100, detector.currentEAR * 300)}%` }} />
                <div className="absolute w-full border-t border-dashed border-red-500/80 z-20" style={{ bottom: `${Math.min(100, (detector.threshold || 0) * 300)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* EAR bars */}
        <div className="flex gap-4">
          {["LEFT EAR", "RIGHT EAR"].map(label => (
            <div key={label} className="flex-1 flex flex-col gap-1">
              <div className="text-[10px] text-gray-500 tracking-widest">{label}</div>
              <div className="h-1 bg-[#1e293b] overflow-hidden rounded">
                <div className="h-full bg-[#00f0ff] transition-all duration-75" style={{ width: `${Math.min(100, detector.currentEAR * 300)}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-1">H {Math.floor(detector.currentEAR * 1000)}</div>
            </div>
          ))}
        </div>

        {/* Blink log */}
        <div className="flex flex-col flex-1 border-t border-b border-[#1e293b] py-2 overflow-hidden flex-shrink-0 min-h-[130px]">
          <div className="text-[10px] text-gray-500 tracking-widest mb-2">BLINK LOG</div>
          <div className="flex-1 overflow-y-auto space-y-1 text-xs">
            {logs.map(log => (
              <div key={log.id} className={`flex items-center gap-2 ${log.kind === "red" ? "text-red-400" : log.kind === "purple" ? "text-[#a855f7]" : log.kind === "green" ? "text-green-400" : log.kind === "orange" ? "text-amber-400" : "text-[#00f0ff]"}`}>
                <span className="opacity-50">[{log.time}]</span>
                <span className="font-bold">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Settings */}
        <div className="flex flex-col gap-3 flex-shrink-0 mt-auto">
          <div className="text-[10px] text-gray-500 tracking-widest flex justify-between">
            SETTINGS
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setDebug(!debug)}>
              DEBUG
              <div className={`w-6 h-3 rounded-full transition-colors relative ${debug ? "bg-[#00f0ff]" : "bg-[#1e293b]"}`}>
                <div className={`absolute top-0.5 left-0.5 w-2 h-2 bg-white rounded-full transition-transform ${debug ? "translate-x-3" : ""}`} />
              </div>
            </div>
          </div>

          {[
            { label: "Dot/dash split", val: split, set: setSplit, min: 100, max: 600, step: 10, unit: "ms" },
            { label: "Letter gap", val: gap, set: setGap, min: 400, max: 1500, step: 50, unit: "ms" },
          ].map(({ label, val, set, min, max, step, unit }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>{label}</span><span>{val}{unit}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={e => set(Number(e.target.value))}
                className="w-full h-1 accent-[#00f0ff] bg-[#1e293b] appearance-none rounded" />
            </div>
          ))}

          <div className="flex flex-col gap-1 pb-2 border-b border-[#1e293b]">
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>EAR threshold</span><span>{sensitivity.toFixed(2)}</span>
            </div>
            <input type="range" min="0.10" max="0.35" step="0.01" value={sensitivity}
              onChange={e => setSensitivity(Number(e.target.value))}
              className="w-full h-1 accent-[#00f0ff] bg-[#1e293b] appearance-none rounded" />
          </div>

          <button
            onClick={detector.startCalibration}
            disabled={detector.status === "calibrating"}
            className={`w-full py-2 bg-transparent text-[#00f0ff] border border-[#00f0ff]/30 text-xs tracking-widest transition-colors uppercase rounded mt-1 ${detector.status === "calibrating" ? "opacity-50 animate-pulse border-[#00f0ff]" : "hover:bg-[#00f0ff]/10"}`}
          >
            [ {detector.status === "calibrating" ? `CALIBRATING...` : "RECALIBRATE"} ]
          </button>
        </div>
      </div>

      {/* ── MAIN PANEL ── */}
      <div className="flex-1 flex flex-col gap-3 border border-[#1e293b] rounded bg-[#0d111b] relative ml-2 p-5 shadow-2xl overflow-y-auto pb-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.03)_0%,transparent_70%)] pointer-events-none rounded" />

        {/* Calibration overlay */}
        {detector.status !== "ready" && (
          <div className="absolute inset-0 z-50 bg-[#080b13]/95 backdrop-blur-md flex flex-col items-center justify-center rounded border-2 border-[#00f0ff]/30 text-center px-4">
            <div className="text-[#00f0ff] font-bold text-2xl sm:text-3xl mb-4 tracking-widest animate-pulse">[ SYSTEM CALIBRATION ]</div>
            {detector.status === "idle" ? (
              <>
                <p className="text-gray-400 mb-8 max-w-md text-sm leading-relaxed">
                  Keep your face visible and eyes naturally open. The system will scan your baseline EAR for 3 seconds automatically.
                </p>
                <button onClick={detector.startCalibration}
                  className="px-8 py-3 bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff] hover:bg-[#00f0ff]/30 transition-colors tracking-widest uppercase rounded shadow-[0_0_15px_rgba(0,240,255,0.4)]">
                  START AUTOMATED SCAN
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center">
                <p className="text-[#00f0ff] text-xl mb-4 animate-pulse">{detector.calibFeedback || "Scanning..."}</p>
                <div className={`w-10 h-10 rounded-full border-2 border-[#00f0ff] ${detector.calibrationCount >= 1 ? "bg-[#00f0ff]" : "animate-pulse"}`} />
                <p className="text-gray-500 mt-8 text-xs tracking-widest">KEEP EYES NATURALLY OPEN — DO NOT BLINK</p>
              </div>
            )}
            {detector.error && (
              <div className="absolute bottom-10 text-red-400 text-xs tracking-widest border border-red-500/50 bg-red-500/10 p-3 rounded">
                ERROR: {detector.error.toUpperCase()} — CHECK CAMERA PERMISSIONS
              </div>
            )}
          </div>
        )}

        {/* Output */}
        <div className="relative border border-[#1e293b] rounded-lg p-5 bg-[#090b10] min-h-[130px] flex flex-col z-10">
          <div className="flex justify-between w-full mb-2">
            <div className="text-[10px] text-gray-500 tracking-widest">OUTPUT</div>
            <div className="flex gap-2">
              <button onClick={handleClear} className="text-[10px] uppercase text-gray-500 hover:text-white px-2 py-1 border border-transparent hover:border-[#1e293b] rounded">CLEAR</button>
              <button onClick={handleSpeak} className="text-[10px] uppercase text-[#eab308] border border-[#eab308]/50 hover:bg-[#eab308]/10 px-3 py-1 rounded">SPEAK ▶</button>
            </div>
          </div>
          <div className="text-4xl sm:text-5xl text-white font-bold tracking-wider break-all">
            {text}
            <span className="text-gray-500 animate-pulse inline-block w-10 text-center">
              {morse ? (morse.includes("-") ? "—" : "·") : (text.length === 0 ? "_" : "")}
            </span>
          </div>
        </div>

        {/* Morse status */}
        <div className="flex justify-between items-center text-sm tracking-wider px-2 z-10">
          <div className="text-gray-500">
            {morse ? morse.split("").map(s => s === "." ? "·" : "—").join(" ") : "waiting for blinks..."}
          </div>
          <div className="text-3xl text-[#00f0ff] font-bold opacity-80" style={{ textShadow: "0 0 10px rgba(0,240,255,0.4)" }}>
            {morse ? decodeMorse(morse) || "?" : "?"}
          </div>
        </div>

        {/* Divider + legend */}
        <div className="h-px bg-[#1e293b] z-10" />
        <div className="flex justify-between text-[11px] text-gray-500 tracking-wider z-10">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00f0ff]" /> Short blink = dot
            <div className="w-4 h-1.5 rounded-full bg-[#a855f7] ml-4" /> Long blink = dash
          </div>
          <div className="flex gap-3 flex-wrap">
            <span>Pause = confirm letter</span>
            <span className="text-amber-400 font-semibold">Double blink = ⌫ backspace</span>
            <span className="text-[#d946ef] font-semibold">Hold 1s = 📋 Quick Words</span>
            <span className="text-red-400 font-semibold">Hold 3s = 🆘 SOS</span>
          </div>
        </div>

        {/* Word predictions */}
        <div className="grid grid-cols-4 gap-2 z-10">
          {[0, 1, 2, 3].map(i => (
            <div key={i}
              className="flex-1 bg-[#101524] border border-[#1e293b] rounded h-10 flex items-center justify-center text-gray-500 cursor-pointer hover:border-gray-500 hover:text-gray-300 transition-colors text-sm"
              onClick={() => { if (predictions[i]) { setText(t => t.trim() + " " + predictions[i] + " "); setMorse(""); } }}>
              {predictions[i] || "—"}
            </div>
          ))}
        </div>

        {/* ── QUICK WORDS (AAC scanner) ── */}
        <div className={`p-3 -m-3 rounded-xl transition-all duration-300 z-10 flex flex-col gap-2 border-2 ${scanMode === "category" && scanCategoryIndex === 0 ? "bg-[#00f0ff]/10 border-[#00f0ff] shadow-[0_0_30px_rgba(0,240,255,0.4)]" : "border-transparent"}`}>
          <div className="text-[10px] text-gray-500 tracking-widest flex justify-between items-center">
            <span>QUICK WORDS</span>
            {scanMode !== "idle" && scanCategoryIndex === 0 && (
              <span className="text-[#d946ef] animate-pulse font-semibold tracking-widest flex items-center gap-1">
                <span className="w-2 h-2 bg-[#d946ef] rounded-full inline-block" />
                {scanMode === "category" ? "CATEGORY FOCUSED" : "SCANNING — BLINK TO SELECT"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {QUICK_WORDS.map((w, i) => {
              const active = scanMode === "item" && scanCategoryIndex === 0 && scanItemIndex === i;
              return (
                <button
                  key={w.label}
                  onClick={() => { speak(w.label); setText(t => (t.trim() ? t.trim() + " " : "") + w.label + " "); setMorse(""); }}
                  className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl border text-xs font-semibold transition-all duration-150 ${active
                    ? "bg-[#d946ef] border-[#d946ef] text-white shadow-[0_0_20px_#d946ef] scale-110"
                    : "bg-[#101524] border-[#1e293b] text-gray-400 hover:border-[#d946ef]/60 hover:text-white"
                    }`}
                >
                  <span className="text-xl">{w.emoji}</span>
                  <span>{w.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── YOUTUBE QUICK PLAY ── */}
        <div className={`p-3 -mx-3 mb-2 rounded-xl transition-all duration-300 z-10 flex flex-col gap-2 pt-4 border-t-2 ${scanMode === "category" && scanCategoryIndex === 1 ? "bg-[#ff0000]/10 border-[#ff0000] shadow-[0_0_30px_rgba(255,0,0,0.4)]" : "border-[#1e293b]"}`}>
          <div className="text-[10px] text-[#ff0000] font-bold tracking-widest uppercase flex items-center justify-between">
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#ff0000]" />YOUTUBE MEDIA</span>
            {scanMode !== "idle" && scanCategoryIndex === 1 && (
              <span className="text-[#ff0000] animate-pulse font-semibold tracking-widest flex items-center gap-1">
                {scanMode === "category" ? "CATEGORY FOCUSED" : "SCANNING — BLINK TO SELECT"}
              </span>
            )}
          </div>

          <div className="flex gap-2 mb-1">
            <input
              type="text"
              value={youtubeSearch}
              onChange={(e) => setYoutubeSearch(e.target.value)}
              placeholder="Search video (music, relaxation, news)..."
              className="flex-1 bg-[#101524] border border-[#1e293b] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-[#ff0000]/50 min-h-[50px]"
            />
            <button
              onClick={() => handleYouTubeSearch()}
              className="bg-[#ff0000] hover:bg-[#ff0000]/80 text-white font-bold px-6 py-3 rounded-lg transition-colors"
            >
              SEARCH
            </button>
            <button
              onClick={() => { setYoutubeSearch(text); handleYouTubeSearch(text); }}
              className="bg-[#1e293b] hover:bg-[#334155] text-white font-bold px-4 py-3 rounded-lg transition-colors border border-[#ff0000]/30 select-none text-xs"
              title="Use written text as search query"
            >
              USE TEXT
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={() => handleYouTubeSearch()}
              className={`flex flex-col items-center justify-center gap-1 min-h-[70px] rounded-xl transition-all duration-150 py-2 border ${scanMode === "item" && scanCategoryIndex === 1 && scanItemIndex === 0
                  ? "bg-[#ff0000] border-[#ff0000] text-white shadow-[0_0_20px_#ff0000] scale-105"
                  : "bg-[#101524] border-[#1e293b] hover:bg-[#ff0000]/10 hover:border-[#ff0000]/50 hover:text-white text-gray-400"
                }`}
            >
              <span className="text-2xl">🔍</span>
              <span className="text-xs font-bold text-center px-1">YT: Typed Text</span>
            </button>
            {YOUTUBE_LINKS.map((v, i) => {
              const active = scanMode === "item" && scanCategoryIndex === 1 && scanItemIndex === i + 1;
              return (
                <button
                  key={v.label}
                  onClick={() => handleYouTubeSearch(v.q)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[70px] rounded-xl transition-all duration-150 py-2 border ${active
                      ? "bg-[#ff0000] border-[#ff0000] text-white shadow-[0_0_20px_#ff0000] scale-105"
                      : "bg-[#101524] border-[#1e293b] hover:bg-[#ff0000]/10 hover:border-[#ff0000]/50 hover:text-white text-gray-400"
                    }`}
                >
                  <span className="text-2xl">{v.emoji}</span>
                  <span className="text-xs font-bold text-center px-1">{v.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── SEND MESSAGE ── */}
        <div className={`p-3 -mx-3 mb-2 rounded-xl transition-all duration-300 z-10 flex flex-col gap-2 pt-4 border-t-2 ${scanMode === "category" && scanCategoryIndex === 2 ? "bg-[#34d399]/10 border-[#34d399] shadow-[0_0_30px_rgba(52,211,153,0.4)]" : "border-[#1e293b]"}`}>
          <div className="text-[10px] text-[#34d399] font-bold tracking-widest uppercase flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#34d399]" />
              SEND MESSAGE ({sendMode === "sms" ? "📱 SMS" : "🟢 WhatsApp"})
            </span>
            <div className="flex gap-2 items-center">
              {scanMode !== "idle" && scanCategoryIndex === 2 && (
                <span className="text-[#34d399] animate-pulse font-semibold tracking-widest flex items-center gap-1">
                  {scanMode === "category" ? "CATEGORY FOCUSED" : "SCANNING — BLINK TO SELECT"}
                </span>
              )}
              <button
                onClick={() => {
                  const next = sendMode === "whatsapp" ? "sms" : "whatsapp";
                  setSendMode(next);
                  localStorage.setItem("blink_sendmode", next);
                }}
                className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors border ${
                  sendMode === "sms"
                    ? "text-blue-400 border-blue-400/50 hover:bg-blue-400/10"
                    : "text-green-400 border-green-400/50 hover:bg-green-400/10"
                }`}
              >
                {sendMode === "sms" ? "Switch to WhatsApp" : "Switch to SMS"}
              </button>
              <button
                onClick={() => setEditingContacts(!editingContacts)}
                className="text-[10px] text-gray-400 hover:text-[#34d399] border border-[#1e293b] hover:border-[#34d399]/50 px-2 py-0.5 rounded transition-colors"
              >
                {editingContacts ? "DONE" : "EDIT"}
              </button>
            </div>
          </div>

          {editingContacts && (
            <div className="flex gap-2 mb-1">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                className="flex-1 bg-[#101524] border border-[#1e293b] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#34d399]/50"
              />
              <input
                type="text"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone (e.g. 919876543210)"
                className="flex-1 bg-[#101524] border border-[#1e293b] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#34d399]/50"
              />
              <button
                onClick={() => {
                  if (newName.trim() && newPhone.trim()) {
                    const updated = [...contacts, { label: newName.trim(), phone: newPhone.trim(), emoji: "👤" }];
                    setContacts(updated);
                    saveContacts(updated);
                    setNewName("");
                    setNewPhone("");
                  }
                }}
                className="bg-[#34d399] hover:bg-[#34d399]/80 text-black font-bold px-4 py-2 rounded-lg transition-colors text-sm"
              >
                ADD
              </button>
            </div>
          )}

          {editingContacts && sendMode === "sms" && (
            <div className="flex flex-col gap-1 mb-1 bg-[#0c1020] border border-[#1e293b] rounded-lg p-3">
              <div className="flex gap-2 items-center">
                <span className="text-[10px] text-gray-500 whitespace-nowrap">SMS API Key:</span>
                <input
                  type="text"
                  defaultValue={localStorage.getItem("blink_sms_key") || ""}
                  onChange={(e) => localStorage.setItem("blink_sms_key", e.target.value.trim())}
                  placeholder="Paste your Fast2SMS API key"
                  className="flex-1 bg-[#101524] border border-[#1e293b] rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-400/50 font-mono"
                />
              </div>
              <div className="text-[9px] text-gray-600">
                Get free key at <span className="text-blue-400">fast2sms.com</span> → Sign up → Dev API → Copy key
              </div>
            </div>
          )}

          {text.trim() ? (
            <div className="text-xs text-gray-400 bg-[#101524] border border-[#1e293b] rounded-lg px-3 py-2 mb-1">
              📝 Message: <span className="text-white font-semibold">"{text.trim()}"</span>
              <span className="text-gray-600 ml-2">via {sendMode === "sms" ? "SMS (Fast2SMS)" : "WhatsApp"}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500 italic mb-1">
              Type a message first using blinks, then select a contact to send via {sendMode === "sms" ? "SMS" : "WhatsApp"}.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {contacts.map((c: typeof DEFAULT_CONTACTS[0], i: number) => {
              const active = scanMode === "item" && scanCategoryIndex === 2 && scanItemIndex === i;
              return (
                <button
                  key={c.label + c.phone}
                  onClick={() => handleSendMessage(c)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[70px] rounded-xl transition-all duration-150 py-2 border relative ${
                    active
                      ? "bg-[#34d399] border-[#34d399] text-black shadow-[0_0_20px_#34d399] scale-105"
                      : "bg-[#101524] border-[#1e293b] hover:bg-[#34d399]/10 hover:border-[#34d399]/50 hover:text-white text-gray-400"
                  }`}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="text-xs font-bold">{c.label}</span>
                  <span className="text-[9px] opacity-60">+{c.phone.slice(0,2)} •••• {c.phone.slice(-4)}</span>
                  {editingContacts && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const updated = contacts.filter((_: typeof DEFAULT_CONTACTS[0], idx: number) => idx !== i);
                        setContacts(updated);
                        saveContacts(updated);
                      }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center hover:bg-red-400"
                    >
                      ✕
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── MORSE REFERENCE BOARD ── */}
        <div className="flex flex-col gap-2 z-10 flex-1 pt-4 border-t border-[#1e293b]">
          <div className="text-[10px] text-gray-500 tracking-widest uppercase">MORSE REFERENCE — CLICK TO TYPE</div>
          <div className="grid grid-cols-8 lg:grid-cols-10 gap-x-2 gap-y-2">
            {Object.keys(MORSE_CHART).map(l => {
              const m = MORSE_CHART[l];
              const isMatch = m === morse;
              return (
                <div key={l}
                  onClick={() => { setText(t => t + l); setMorse(""); }}
                  className={`group flex flex-col items-center justify-center p-2 rounded cursor-pointer border transition-colors ${isMatch ? "bg-[#00f0ff]/10 border-[#00f0ff]/50" : "bg-[#101524] border-[#1e293b] hover:bg-[#00f0ff]/10 hover:border-[#00f0ff]/50"}`}>
                  <div className={`font-bold text-lg mb-1 ${isMatch ? "text-[#00f0ff]" : "text-white group-hover:text-[#00f0ff]"}`}>{l}</div>
                  <div className="flex gap-0.5">
                    {m.split("").map((c, i) => (
                      c === "." ?
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00f0ff]" /> :
                        <div key={i} className="w-3 h-1.5 rounded-full bg-[#a855f7]" />
                    ))}
                  </div>
                </div>
              );
            })}
            <div onClick={() => { setText(t => t + " "); setMorse(""); }}
              className="group flex flex-col items-center justify-center p-2 rounded cursor-pointer border bg-[#101524] border-[#1e293b] hover:bg-[#00f0ff]/10 hover:border-[#00f0ff]/50 transition-colors">
              <div className="font-bold text-sm text-white group-hover:text-[#00f0ff]">SPC</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-2 flex justify-between text-[9px] text-[#475569] border-t border-[#1e293b]/50 bg-[#090b10]/80 z-10">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#34d399]" />
            thresh={sensitivity.toFixed(2)} · split={split}ms
          </div>
          <div>KEYS: 5=dot · 1=dash · ENTER=confirm · BKSP=delete · SPACE=speak</div>
        </div>
      </div>
    </div>
  );
};

export default Index;
