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
import { Volume2, RotateCcw, Eraser, Sun, Moon, Mic } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CONFIRM_DELAY_MS = 800;
const STORAGE_KEY = "blinkvoice.transcript.v1";

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
  const [sensitivity, setSensitivity] = useState(0.6);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [lastSpoken, setLastSpoken] = useState<string>("");

  const confirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transcript));
    } catch {}
  }, [transcript]);

  const flash = useCallback(() => {
    setBlinkFlash(true);
    window.setTimeout(() => setBlinkFlash(false), 400);
  }, []);

  const commitMorse = useCallback(() => {
    setMorse((current) => {
      if (!current) return current;
      const decoded = decodeMorse(current);
      if (decoded) {
        setText((t) => t + decoded);
      }
      return "";
    });
  }, []);

  const scheduleConfirm = useCallback(() => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = window.setTimeout(() => {
      commitMorse();
    }, CONFIRM_DELAY_MS);
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
      {
        id: crypto.randomUUID(),
        text: "🚨 EMERGENCY ALERT TRIGGERED",
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const handleBlink = useCallback(
    (e: BlinkEvent) => {
      if (e.type === "double") {
        // Delete last char of text or last morse symbol
        flash();
        setMorse((m) => {
          if (m.length > 0) return m.slice(0, -1);
          setText((t) => t.slice(0, -1));
          return m;
        });
        return;
      }
      if (e.type === "long") {
        addSymbol("-");
        return;
      }
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

  // Auto-speak completed words when user adds a space
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

  return (
    <main className="min-h-screen text-foreground">
      <EmergencyOverlay active={emergency} onDismiss={() => setEmergency(false)} />

      <div className="container max-w-7xl mx-auto py-4 sm:py-6 px-3 sm:px-6 space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
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

          <div className="flex items-center gap-2">
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

        {/* Camera + status */}
        <CameraPanel
          videoRef={videoRef}
          cameraReady={detector.cameraReady}
          status={detector.status}
          isClosed={detector.isClosed}
          ear={detector.currentEAR}
          threshold={detector.threshold}
          blinkFlash={blinkFlash}
        />

        {/* Calibration */}
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

        {/* Main grid */}
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

            {/* Controls */}
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

            {/* Help legend */}
            <div className="rounded-lg border border-border/50 bg-card/40 p-4 text-xs sm:text-sm text-muted-foreground grid sm:grid-cols-2 gap-2">
              <div><span className="text-primary font-semibold">Short blink</span> → dot (•)</div>
              <div><span className="text-primary font-semibold">Long blink</span> (&gt;700ms) → dash (—)</div>
              <div><span className="text-primary font-semibold">Double blink</span> → delete</div>
              <div><span className="text-destructive font-semibold">Hold eyes closed</span> (&gt;2s) → emergency</div>
            </div>
          </div>

          <div className="lg:col-span-1 min-h-[400px]">
            <Transcript
              entries={transcript}
              onClear={() => setTranscript([])}
            />
          </div>
        </div>
      </div>
    </main>
  );
};

export default Index;
