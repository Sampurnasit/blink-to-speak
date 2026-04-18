import { useEffect, useRef, useState, useCallback } from "react";
import { FaceMesh, Results } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

// MediaPipe FaceMesh eye landmark indices (6 points each)
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ear(landmarks: Pt[], idx: number[]): number {
  const p = idx.map((i) => landmarks[i]);
  const v1 = dist(p[1], p[5]);
  const v2 = dist(p[2], p[4]);
  const h = dist(p[0], p[3]);
  if (h < 1e-6) return 0.3;
  return (v1 + v2) / (2 * h);
}

export type BlinkEvent = {
  type: "short" | "long" | "double" | "emergency";
  duration: number;
};

export type CalibrationStatus = "idle" | "calibrating" | "ready";

export interface UseBlinkDetectorOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  onBlink?: (e: BlinkEvent) => void;
  onEmergency?: () => void;
  enabled: boolean;
  sensitivity: number; // 0..1, scales detection threshold
}

// --- Tunables for false-trigger reduction ---
const MIN_CLOSED_FRAMES = 3;        // ~100ms at 30fps — must hold closed
const MIN_OPEN_FRAMES = 3;          // hysteresis on reopening
const MIN_BLINK_MS = 110;           // shorter than this = noise
const MAX_SHORT_MS = 450;           // dot upper bound
const MIN_LONG_MS = 750;            // dash lower bound (gap reduces ambiguity)
const DOUBLE_BLINK_GAP_MS = 450;    // two short blinks within this window
const EMERGENCY_HOLD_MS = 2000;
const DOUBLE_BLINK_LATCH_MS = 600;  // suppress next event after a double

export function useBlinkDetector({
  videoRef,
  onBlink,
  onEmergency,
  enabled,
  sensitivity,
}: UseBlinkDetectorOptions) {
  const [status, setStatus] = useState<CalibrationStatus>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Adaptive baseline (open-eye EAR). Initialized neutrally, refined in real time.
  const baselineRef = useRef<number>(0.28);
  const baselineVarRef = useRef<number>(0.0008); // running variance for adaptive band
  const closedThresholdRef = useRef<number>(0.20);

  const closeStartRef = useRef<number | null>(null);
  const lastBlinkEndRef = useRef<number>(0);
  const lastBlinkDurationRef = useRef<number>(0);
  const pendingShortBlinkRef = useRef<{ time: number; duration: number } | null>(null);
  const pendingShortTimerRef = useRef<number | null>(null);
  const suppressUntilRef = useRef<number>(0);

  const calibrationOpenSamplesRef = useRef<number[]>([]);
  const calibrationBlinkSamplesRef = useRef<number[]>([]);
  const calibrationBlinksRef = useRef<number>(0);

  const closedFramesRef = useRef<number>(0);
  const openFramesRef = useRef<number>(0);
  const emergencyFiredRef = useRef<boolean>(false);

  const onBlinkRef = useRef(onBlink);
  const onEmergencyRef = useRef(onEmergency);
  useEffect(() => { onBlinkRef.current = onBlink; }, [onBlink]);
  useEffect(() => { onEmergencyRef.current = onEmergency; }, [onEmergency]);

  const startCalibration = useCallback(() => {
    setStatus("calibrating");
    calibrationOpenSamplesRef.current = [];
    calibrationBlinkSamplesRef.current = [];
    calibrationBlinksRef.current = 0;
    setCalibrationCount(0);
  }, []);

  const emitShort = useCallback((duration: number) => {
    const now = performance.now();
    if (now < suppressUntilRef.current) return;
    onBlinkRef.current?.({ type: "short", duration });
  }, []);

  const emitLong = useCallback((duration: number) => {
    const now = performance.now();
    if (now < suppressUntilRef.current) return;
    onBlinkRef.current?.({ type: "long", duration });
  }, []);

  const emitDouble = useCallback((duration: number) => {
    onBlinkRef.current?.({ type: "double", duration });
    suppressUntilRef.current = performance.now() + DOUBLE_BLINK_LATCH_MS;
  }, []);

  useEffect(() => {
    if (!enabled || !videoRef.current) return;
    let camera: Camera | null = null;
    let faceMesh: FaceMesh | null = null;
    let cancelled = false;

    const onResults = (results: Results) => {
      if (cancelled) return;
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        // No face — reset transient state to avoid stuck "closed" misfires
        closedFramesRef.current = 0;
        openFramesRef.current = 0;
        if (closeStartRef.current !== null) {
          closeStartRef.current = null;
          setIsClosed(false);
        }
        return;
      }

      const landmarks = results.multiFaceLandmarks[0] as Pt[];
      const leftEAR = ear(landmarks, LEFT_EYE);
      const rightEAR = ear(landmarks, RIGHT_EYE);

      // Use the MAX of both eyes — robust if one eye is shadowed in low light
      // (a true blink closes both; partial occlusion only affects one).
      const observed = Math.max(leftEAR, rightEAR);
      // Light smoothing to suppress per-frame jitter
      const avg = currentEARRef.current * 0.4 + observed * 0.6;
      currentEARRef.current = avg;
      setCurrentEAR(avg);

      // Adaptive threshold: baseline minus N*std, scaled by sensitivity.
      // Lower sensitivity = require deeper drop (fewer false triggers).
      const std = Math.sqrt(baselineVarRef.current);
      const sensFactor = 2.0 + (1 - sensitivity) * 2.0; // 2.0..4.0 stds below baseline
      const adaptive = baselineRef.current - sensFactor * std;
      // Hard floor to avoid impossibly low thresholds in noisy low-light feeds
      const hardFloor = baselineRef.current * 0.55;
      const threshold = Math.max(adaptive, hardFloor);
      closedThresholdRef.current = threshold;

      const closed = avg < threshold;

      if (closed) {
        closedFramesRef.current += 1;
        openFramesRef.current = 0;
      } else {
        openFramesRef.current += 1;
        closedFramesRef.current = 0;
      }

      const stableClosed = closedFramesRef.current >= MIN_CLOSED_FRAMES;
      const stableOpen = openFramesRef.current >= MIN_OPEN_FRAMES;

      const now = performance.now();

      if (stableClosed && closeStartRef.current === null) {
        // Account for the frames it took to confirm closure
        closeStartRef.current = now - (MIN_CLOSED_FRAMES * 33);
        setIsClosed(true);
      }

      // Emergency: hold while closed
      if (closeStartRef.current !== null && !emergencyFiredRef.current) {
        const heldFor = now - closeStartRef.current;
        if (heldFor > EMERGENCY_HOLD_MS && status === "ready") {
          emergencyFiredRef.current = true;
          onEmergencyRef.current?.();
        }
      }

      if (stableOpen && closeStartRef.current !== null) {
        const duration = now - closeStartRef.current;
        const start = closeStartRef.current;
        closeStartRef.current = null;
        setIsClosed(false);
        emergencyFiredRef.current = false;

        // Reject micro-flickers
        if (duration < MIN_BLINK_MS) return;
        // Skip if we already emitted emergency on this hold
        if (duration > EMERGENCY_HOLD_MS) return;

        if (status === "calibrating") {
          calibrationBlinkSamplesRef.current.push(avg);
          calibrationBlinksRef.current += 1;
          setCalibrationCount(calibrationBlinksRef.current);
          if (calibrationBlinksRef.current >= 3) {
            // Lock in baseline from collected open-eye samples
            const opens = calibrationOpenSamplesRef.current;
            if (opens.length > 10) {
              const sorted = [...opens].sort((a, b) => a - b);
              // Use median for robustness
              const median = sorted[Math.floor(sorted.length / 2)];
              baselineRef.current = median;
              const mean = opens.reduce((s, v) => s + v, 0) / opens.length;
              const variance =
                opens.reduce((s, v) => s + (v - mean) ** 2, 0) / opens.length;
              baselineVarRef.current = Math.max(variance, 0.0003);
            }
            setStatus("ready");
          }
          return;
        }

        if (status !== "ready") return;

        const sinceLast = start - lastBlinkEndRef.current;
        lastBlinkEndRef.current = now;
        lastBlinkDurationRef.current = duration;

        // Long blink (dash) — clear unambiguous signal
        if (duration >= MIN_LONG_MS) {
          // Cancel any pending short (it was actually a different gesture)
          if (pendingShortTimerRef.current) {
            window.clearTimeout(pendingShortTimerRef.current);
            pendingShortTimerRef.current = null;
            pendingShortBlinkRef.current = null;
          }
          emitLong(duration);
          return;
        }

        // Reject ambiguous middle range (450–750ms) to reduce dot/dash confusion
        if (duration > MAX_SHORT_MS && duration < MIN_LONG_MS) {
          return;
        }

        // Short blink — buffer briefly to detect a possible double-blink
        const prev = pendingShortBlinkRef.current;
        if (prev && now - prev.time < DOUBLE_BLINK_GAP_MS) {
          // It's a double-blink
          if (pendingShortTimerRef.current) {
            window.clearTimeout(pendingShortTimerRef.current);
            pendingShortTimerRef.current = null;
          }
          pendingShortBlinkRef.current = null;
          emitDouble(duration);
          return;
        }

        // Buffer this short and wait to see if a second one follows
        pendingShortBlinkRef.current = { time: now, duration };
        if (pendingShortTimerRef.current) {
          window.clearTimeout(pendingShortTimerRef.current);
        }
        pendingShortTimerRef.current = window.setTimeout(() => {
          const p = pendingShortBlinkRef.current;
          pendingShortBlinkRef.current = null;
          pendingShortTimerRef.current = null;
          if (p) emitShort(p.duration);
        }, DOUBLE_BLINK_GAP_MS);
      }

      // Continuously refine baseline + variance from open-eye frames
      if (!closed && openFramesRef.current > 5) {
        const b = baselineRef.current;
        baselineRef.current = b * 0.97 + avg * 0.03;
        const diff = avg - baselineRef.current;
        baselineVarRef.current = baselineVarRef.current * 0.97 + diff * diff * 0.03;

        if (status === "calibrating") {
          calibrationOpenSamplesRef.current.push(avg);
        }
      }
    };

    const init = async () => {
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        const video = videoRef.current!;
        // Request camera with low-light friendly hints
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
            facingMode: "user",
          },
          audio: false,
        });
        video.srcObject = stream;
        await video.play().catch(() => {});

        // Apply low-light constraints if supported (best-effort, ignored otherwise)
        try {
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as any;
          const advanced: any = {};
          if (caps.exposureMode?.includes?.("continuous")) advanced.exposureMode = "continuous";
          if (caps.whiteBalanceMode?.includes?.("continuous")) advanced.whiteBalanceMode = "continuous";
          if (caps.focusMode?.includes?.("continuous")) advanced.focusMode = "continuous";
          if (Object.keys(advanced).length) {
            await track.applyConstraints({ advanced: [advanced] }).catch(() => {});
          }
        } catch {}

        camera = new Camera(video, {
          onFrame: async () => {
            if (faceMesh && !cancelled) await faceMesh.send({ image: video });
          },
          width: 640,
          height: 480,
        });
        await camera.start();
        setCameraReady(true);
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "Camera error");
      }
    };

    init();

    return () => {
      cancelled = true;
      try { camera?.stop(); } catch {}
      try { faceMesh?.close(); } catch {}
      if (pendingShortTimerRef.current) {
        window.clearTimeout(pendingShortTimerRef.current);
        pendingShortTimerRef.current = null;
      }
      // Stop any tracks we attached directly
      try {
        const v = videoRef.current;
        const s = v?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        if (v) v.srcObject = null;
      } catch {}
      setCameraReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, status, sensitivity]);

  return {
    status,
    cameraReady,
    currentEAR,
    threshold: closedThresholdRef.current,
    isClosed,
    calibrationCount,
    error,
    startCalibration,
  };
}

// EAR smoothing buffer (module-scope ref alternative for the hook closure)
const currentEARRef = { current: 0.3 };
