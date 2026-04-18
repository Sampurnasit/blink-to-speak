import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlinkDetector, BlinkEvent } from "@/hooks/useBlinkDetector";
import { decodeMorse, predictWords } from "@/lib/morse";
import { speak } from "@/lib/speech";
import { CameraPanel } from "@/components/blinkvoice/CameraPanel";
import { CalibrationCard } from "@/components/blinkvoice/CalibrationCard";
import { InputDisplay, FallbackInput } from "@/components/blinkvoice/InputDisplay";
import { QuickPhrases, Predictions } from "@/components/blinkvoice/QuickPhrases";
import { Transcript, TranscriptEntry } from "@/components/blinkvoice/Transcript";
import { EmergencyOverlay } from "@/components/blinkvoice/EmergencyOverlay";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Volume2, RotateCcw, Eraser, Sun, Moon, Mic, Eye, CircleDot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CONFIRM_DELAY_MS = 800;
const STORAGE_KEY = "blinkvoice.transcript.v1";
const MODE_KEY = "blinkvoice.patientMode.v1";

const Index = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  const [morse, setMorse] = useState("");
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [emergency, setEmergency] = useState(false);
  const [blinkFlash, setBlinkFlash] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.5); // default lower → fewer false triggers
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [lastSpoken, setLastSpoken] = useState<string>("");
  const [patientMode, setPatientMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const confirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(transcript)); } catch {}
  }, [transcript]);

  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, patientMode ? "1" : "0"); } catch {}
  }, [patientMode]);

  const flash = useCallback(() => {
    setBlinkFlash(true);
    window.setTimeout(() => setBlinkFlash(false), 400);
  }, []);

  const commitMorse = useCallback(() => {
    setMorse((current) => {
      if (!current) return current;
      const decoded = decodeMorse(current);
      if (decoded) setText((t) => t + decoded);
      return "";
    });
  }, []);

  const scheduleConfirm = useCallback(() => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => commitMorse(), CONFIRM_DELAY_MS);
  }, [commitMorse]);

  const addSymbol = useCallback(
    (s: "." | "-") => {
      flash();
      setMorse((m) => m + s);
      scheduleConfirm();
    },
    [flash, scheduleConfirm]
  );

  const speakAndLog = useCallback((message: string) => {
    if (!message.trim()) return;
    speak(message);
    setLastSpoken(message);
    setTranscript((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: message, timestamp: Date.now() },
    ]);
  }, []);

  const handleEmergency = useCallback(() => {
    setEmergency(true);
    speak("Patient needs immediate assistance", { volume: 1, rate: 1 });
    setTranscript((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: "🚨 EMERGENCY ALERT TRIGGERED", timestamp: Date.now() },
    ]);
  }, []);

  const handleBlink = useCallback(
    (e: BlinkEvent) => {
      if (e.type === "double") {
        flash();
        setMorse((m) => {
          if (m.length > 0) return m.slice(0, -1);
          setText((t) => t.slice(0, -1));
          return m;
        });
        return;
      }
      if (e.type === "long") return addSymbol("-");
      addSymbol(".");
    },
    [addSymbol, flash]
  );

  const detector = useBlinkDetector({
    videoRef,
    onBlink: handleBlink,
    onEmergency: handleEmergency,
    enabled: true,
    sensitivity,
  });

  const handleSpace = useCallback(() => {
    if (morse) commitMorse();
    setText((t) => {
      const trimmed = t.trim();
      if (trimmed) {
        const lastWord = trimmed.split(" ").pop()!;
        speak(lastWord);
      }
      return t + " ";
    });
  }, [morse, commitMorse]);

  const handleSpeak = useCallback(() => {
    if (morse) commitMorse();
    const message = text.trim();
    if (message) speakAndLog(message);
  }, [morse, commitMorse, text, speakAndLog]);

  const handleRepeat = useCallback(() => {
    if (lastSpoken) speak(lastSpoken);
  }, [lastSpoken]);

  const handleClear = useCallback(() => {
    setText("");
    setMorse("");
  }, []);

  const handlePickWord = useCallback((word: string) => {
    setText((t) => {
      const parts = t.split(" ");
      parts[parts.length - 1] = word;
      return parts.join(" ") + " ";
    });
    speak(word);
  }, []);

  const handleQuickPhrase = useCallback(
    (phrase: string) => {
      speakAndLog(phrase);
      toast({ title: "Speaking", description: phrase });
    },
    [speakAndLog, toast]
  );

  const currentPrefix = useMemo(() => {
    const parts = text.split(" ");
    return parts[parts.length - 1] ?? "";
  }, [text]);

  const predictions = useMemo(() => predictWords(currentPrefix, 4), [currentPrefix]);

  // Hidden video element used by the detector even when camera UI is hidden
  const HiddenVideo = (
    <video
      ref={videoRef}
      className="hidden"
      playsInline
      muted
    />
  );

  // ---------- PATIENT MODE: minimal, low-effort UI ----------
  if (patientMode) {
    return (
      <main className="min-h-screen text-foreground">
        <EmergencyOverlay active={emergency} onDismiss={() => setEmergency(false)} />
        {HiddenVideo}

        {/* Tiny top bar — almost invisible */}
        <div className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-background/70 backdrop-blur border-b border-border/40">
          <div className="flex items-center gap-3 text-sm">
            <CircleDot className={cn(
              "w-3 h-3",
              detector.status === "ready" ? "text-accent" : "text-warning",
              detector.isClosed && "text-warning fill-current"
            )} />
            <span className="text-muted-foreground">
              {detector.status === "ready" ? "Ready" :
               detector.status === "calibrating" ? "Calibrating…" : "Setup needed"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Patient Mode</span>
            <Switch checked={patientMode} onCheckedChange={setPatientMode} />
          </div>
        </div>

        <div className="pt-14 pb-6 px-4 sm:px-8 max-w-4xl mx-auto space-y-6">
          {detector.status !== "ready" && (
            <CalibrationCard
              status={detector.status}
              count={detector.calibrationCount}
              onStart={detector.startCalibration}
              cameraReady={detector.cameraReady}
            />
          )}

          {/* HUGE message display — the only thing patient really needs to see */}
          <div
            className={cn(
              "rounded-3xl border-2 border-border/60 bg-card/70 backdrop-blur p-8 sm:p-12 min-h-[40vh] flex flex-col items-center justify-center text-center transition-all",
              blinkFlash && "blink-flash border-primary"
            )}
          >
            {morse && (
              <div className="flex gap-3 mb-6">
                {morse.split("").map((s, i) => (
                  <span
                    key={i}
                    className="morse-symbol text-6xl sm:text-7xl font-black text-primary"
                  >
                    {s === "." ? "•" : "—"}
                  </span>
                ))}
              </div>
            )}
            <p className="text-5xl sm:text-7xl font-black text-display leading-tight break-words">
              {text || (
                <span className="text-muted-foreground/50 italic font-normal text-3xl">
                  Blink to speak…
                </span>
              )}
            </p>
          </div>

          {/* Big quick phrases — zero-effort emergencies */}
          <QuickPhrases onSpeak={handleQuickPhrase} large />

          {/* Single primary action */}
          <Button
            onClick={handleSpeak}
            disabled={!text.trim() && !morse}
            size="lg"
            className="w-full h-20 text-2xl font-black gradient-primary text-primary-foreground hover:opacity-90"
          >
            <Volume2 className="w-7 h-7 mr-3" /> Speak Message
          </Button>
        </div>
      </main>
    );
  }

  // ---------- FULL MODE: clinician / setup view ----------
  return (
    <main className="min-h-screen text-foreground">
      <EmergencyOverlay active={emergency} onDismiss={() => setEmergency(false)} />

      <div className="container max-w-7xl mx-auto py-4 sm:py-6 px-3 sm:px-6 space-y-4">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg">
              <Mic className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-display">
                BlinkVoice
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Eye-blink communication for patients
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/60 border border-border/50">
              <Eye className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Patient Mode</span>
              <Switch checked={patientMode} onCheckedChange={setPatientMode} />
            </div>
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg bg-card/60 border border-border/50">
              <span className="text-xs text-muted-foreground">Sensitivity</span>
              <Slider
                value={[sensitivity * 100]}
                onValueChange={(v) => setSensitivity(v[0] / 100)}
                min={20}
                max={95}
                step={5}
                className="w-32"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </header>

        <CameraPanel
          videoRef={videoRef}
          cameraReady={detector.cameraReady}
          status={detector.status}
          isClosed={detector.isClosed}
          ear={detector.currentEAR}
          threshold={detector.threshold}
          blinkFlash={blinkFlash}
        />

        <CalibrationCard
          status={detector.status}
          count={detector.calibrationCount}
          onStart={detector.startCalibration}
          cameraReady={detector.cameraReady}
        />

        {detector.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive-foreground p-4 text-sm">
            Camera error: {detector.error}. Please grant camera access and reload.
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <InputDisplay morse={morse} text={text} blinkFlash={blinkFlash} />

            <FallbackInput
              onDot={() => addSymbol(".")}
              onDash={() => addSymbol("-")}
              onConfirm={commitMorse}
              onSpace={handleSpace}
            />

            <Predictions words={predictions} onPick={handlePickWord} />

            <QuickPhrases onSpeak={handleQuickPhrase} />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <Button
                onClick={handleSpeak}
                size="lg"
                className="h-16 text-lg font-bold gradient-primary text-primary-foreground hover:opacity-90"
              >
                <Volume2 className="w-5 h-5 mr-2" /> Speak Now
              </Button>
              <Button
                onClick={handleRepeat}
                size="lg"
                variant="outline"
                className="h-16 text-lg font-bold border-2"
                disabled={!lastSpoken}
              >
                <RotateCcw className="w-5 h-5 mr-2" /> Repeat
              </Button>
              <Button
                onClick={handleClear}
                size="lg"
                variant="outline"
                className="h-16 text-lg font-bold border-2"
              >
                <Eraser className="w-5 h-5 mr-2" /> Clear
              </Button>
              <Button
                onClick={handleEmergency}
                size="lg"
                className="h-16 text-lg font-bold bg-destructive text-destructive-foreground hover:bg-destructive/90 glow-emergency"
              >
                🚨 Emergency
              </Button>
            </div>

            <div className="rounded-lg border border-border/50 bg-card/40 p-4 text-xs sm:text-sm text-muted-foreground grid sm:grid-cols-2 gap-2">
              <div><span className="text-primary font-semibold">Short blink</span> → dot (•)</div>
              <div><span className="text-primary font-semibold">Long blink</span> (&gt;750ms) → dash (—)</div>
              <div><span className="text-primary font-semibold">Double blink</span> → delete</div>
              <div><span className="text-destructive font-semibold">Hold eyes closed</span> (&gt;2s) → emergency</div>
            </div>
          </div>

          <div className="lg:col-span-1 min-h-[400px]">
            <Transcript entries={transcript} onClear={() => setTranscript([])} />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Index;
