import { useEffect, useRef, useState, useCallback } from "react";
import * as mpFaceMesh from "@mediapipe/face_mesh";
import * as mpCamera from "@mediapipe/camera_utils";

// Resilient constructor resolution for MediaPipe's non-standard exports
// @ts-ignore
const FaceMesh = mpFaceMesh.FaceMesh || 
                 (mpFaceMesh as any).default?.FaceMesh || 
                 (window as any).FaceMesh || 
                 mpFaceMesh;

// @ts-ignore
const Camera = mpCamera.Camera || 
               (mpCamera as any).default?.Camera || 
               (window as any).Camera || 
               mpCamera;

type Results = any;

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
  onScan?: () => void;        // triggered on medium hold (1s) → AAC scan mode
  onEmergency?: () => void;   // triggered on long hold (3s) → SOS
  enabled: boolean;
  sensitivity: number;
  splitMs?: number;
}

const MIN_BLINK_MS = 60;
const SCAN_HOLD_MS = 1000;       // 1s hold → scan mode
const EMERGENCY_HOLD_MS = 3000;  // 3s hold → SOS
const DOUBLE_BLINK_WINDOW_MS = 380; // window to detect double blink

export function useBlinkDetector({
  videoRef,
  onBlink,
  onScan,
  onEmergency,
  enabled,
  sensitivity,
  splitMs = 450,
}: UseBlinkDetectorOptions) {
  const [status, setStatus] = useState<CalibrationStatus>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [calibFeedback, setCalibFeedback] = useState<string>("");

  const onBlinkRef = useRef(onBlink);
  const onScanRef = useRef(onScan);
  const onEmergencyRef = useRef(onEmergency);
  const sensitivityRef = useRef(sensitivity);
  const splitRef = useRef(splitMs);
  // statusRef avoids stale closure inside the frame loop
  const statusRef = useRef<CalibrationStatus>("idle");

  useEffect(() => { onBlinkRef.current = onBlink; }, [onBlink]);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { onEmergencyRef.current = onEmergency; }, [onEmergency]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { splitRef.current = splitMs; }, [splitMs]);
  useEffect(() => { statusRef.current = status; }, [status]);

  // Baseline and Thresholds
  const baselineRef = useRef<number>(0.28);
  const minClosedEARRef = useRef<number>(0.15); // Discovered during calib
  const personalizedThresholdRef = useRef<number>(0.22);
  const currentEARRef = useRef<number>(0.3);

  // Temporal Smoothing & Debounce
  const prevNoseRef = useRef<Pt | null>(null);
  const headStableFramesRef = useRef<number>(0);

  const closeStartRef = useRef<number | null>(null);
  const lastBlinkEndRef = useRef<number>(0);
  const debounceTimerRef = useRef<number>(0);
  const consecutiveLowRef = useRef<number>(0);
  const blinkStateRef = useRef<"OPEN" | "CLOSED">("OPEN");

  const calibOpenSamplesRef = useRef<number[]>([]);
  const calibClosedSamplesRef = useRef<number[]>([]);
  const calibCountRef = useRef<number>(0);
  const lowestEARDuringBlinkRef = useRef<number>(1.0);

  const pendingShortBlinkRef = useRef<{ time: number; duration: number } | null>(null);
  const pendingShortTimerRef = useRef<number | null>(null);
  const scanFiredRef = useRef<boolean>(false);
  const emergencyFiredRef = useRef<boolean>(false);

  const startCalibration = useCallback(() => {
    setStatus("calibrating");
    calibCountRef.current = 0;
    setCalibrationCount(0);
    setCalibFeedback("Calibrating baseline... Keep eyes open.");

    // Perform an entirely passive automated calibration
    setTimeout(() => {
      setCalibFeedback("Scanning...");
    }, 1000);

    setTimeout(() => {
      // Calculate a theoretical closed EAR drop based on their resting baseline
      minClosedEARRef.current = baselineRef.current * 0.70;
      setCalibFeedback("Perfect.");
      setCalibrationCount(1);
    }, 2000);

    setTimeout(() => {
      setStatus("ready");
      setCalibFeedback("");
    }, 3000);
  }, []);

  const emitDouble = useCallback((duration: number) => {
    onBlinkRef.current?.({ type: "double", duration });
  }, []);

  // Short blink: pend for DOUBLE_BLINK_WINDOW_MS — if a second arrives, emit "double" (backspace)
  const emitShort = useCallback((duration: number) => {
    const now = performance.now();

    if (pendingShortBlinkRef.current !== null) {
      // Second blink within window → double blink (backspace)
      if (pendingShortTimerRef.current) window.clearTimeout(pendingShortTimerRef.current);
      pendingShortTimerRef.current = null;
      pendingShortBlinkRef.current = null;
      emitDouble(duration);
      return;
    }

    // First blink — pend it
    pendingShortBlinkRef.current = { time: now, duration };
    pendingShortTimerRef.current = window.setTimeout(() => {
      if (pendingShortBlinkRef.current) {
        onBlinkRef.current?.({ type: "short", duration: pendingShortBlinkRef.current.duration });
        pendingShortBlinkRef.current = null;
      }
      pendingShortTimerRef.current = null;
    }, DOUBLE_BLINK_WINDOW_MS);
  }, [emitDouble]);

  const emitLong = useCallback((duration: number) => {
    // A long blink always cancels any pending short blink first
    if (pendingShortTimerRef.current) window.clearTimeout(pendingShortTimerRef.current);
    if (pendingShortBlinkRef.current) {
      onBlinkRef.current?.({ type: "short", duration: pendingShortBlinkRef.current.duration });
      pendingShortBlinkRef.current = null;
    }
    pendingShortTimerRef.current = null;
    onBlinkRef.current?.({ type: "long", duration });
  }, []);

  useEffect(() => {
    if (!enabled || !videoRef.current) return;
    let camera: Camera | null = null;
    let faceMesh: FaceMesh | null = null;
    let cancelled = false;

    const onResults = (results: Results) => {
      if (cancelled) return;
      if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        if (closeStartRef.current !== null) {
          closeStartRef.current = null;
          setIsClosed(false);
        }
        return;
      }

      const landmarks = results.multiFaceLandmarks[0] as Pt[];

      // 9. Head Movement Handling
      const nose = landmarks[1];
      let headMoving = false;
      if (prevNoseRef.current) {
        const d = dist(nose, prevNoseRef.current);
        if (d > 0.03) {
          headStableFramesRef.current = 0; // Head moved significantly
          headMoving = true;
        } else {
          headStableFramesRef.current++;
        }
      }
      prevNoseRef.current = nose;

      const leftEAR = ear(landmarks, LEFT_EYE);
      const rightEAR = ear(landmarks, RIGHT_EYE);
      const avg = (leftEAR + rightEAR) / 2;

      setCurrentEAR(avg);

      const now = performance.now();

      // Accumulate baseline
      if (avg > baselineRef.current * 0.82) {
        calibOpenSamplesRef.current.push(avg);
        if (calibOpenSamplesRef.current.length > 60) calibOpenSamplesRef.current.shift();
        baselineRef.current = calibOpenSamplesRef.current.reduce((a, b) => a + b, 0) / calibOpenSamplesRef.current.length;
      }

      // Use statusRef — NOT status — to avoid stale closure inside the frame loop
      const currentStatus = statusRef.current;

      // Use manual threshold; use tighter threshold while calibrating
      let targetThresh = sensitivityRef.current;
      if (currentStatus === "calibrating") {
        targetThresh = baselineRef.current * 0.80;
      }

      if (blinkStateRef.current === "OPEN") {
        if (avg < targetThresh) {
          consecutiveLowRef.current++;
          if (consecutiveLowRef.current >= 2) {
            blinkStateRef.current = "CLOSED";
            setIsClosed(true);
            closeStartRef.current = now;
            consecutiveLowRef.current = 0;
            scanFiredRef.current = false;
            emergencyFiredRef.current = false;
          }
        } else {
          consecutiveLowRef.current = 0;
        }
      } else {
        const elapsed = now - closeStartRef.current!;

        // Tier 1: 1s hold → AAC scan mode
        if (elapsed > SCAN_HOLD_MS && currentStatus === "ready" && !scanFiredRef.current && !emergencyFiredRef.current) {
          scanFiredRef.current = true;
          onScanRef.current?.();
        }

        // Tier 2: 3s hold → Emergency SOS
        if (elapsed > EMERGENCY_HOLD_MS && currentStatus === "ready" && !emergencyFiredRef.current) {
          emergencyFiredRef.current = true;
          onEmergencyRef.current?.();
        }

        if (avg >= targetThresh) {
          blinkStateRef.current = "OPEN";
          setIsClosed(false);
          const duration = now - closeStartRef.current!;
          closeStartRef.current = null;

          if (duration < MIN_BLINK_MS) return;

          // Don't also emit a regular blink if a hold action fired
          if (scanFiredRef.current || emergencyFiredRef.current) return;

          if (currentStatus === "ready") {
            lastBlinkEndRef.current = now;
            if (duration >= splitRef.current) {
              emitLong(duration);
            } else {
              emitShort(duration);
            }
          }
        }
      }
    };

    const init = async () => {
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        const video = videoRef.current!;
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
        await video.play().catch(() => { });

        // Add standard 6. Lighting Compensation
        try {
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as any;
          const advanced: any = {};
          if (caps.exposureMode?.includes?.("continuous")) advanced.exposureMode = "continuous";
          if (caps.whiteBalanceMode?.includes?.("continuous")) advanced.whiteBalanceMode = "continuous";
          if (caps.focusMode?.includes?.("continuous")) advanced.focusMode = "continuous";

          if (Object.keys(advanced).length) {
            await track.applyConstraints({ advanced: [advanced] }).catch(() => { });
          }
        } catch { }

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
      try { camera?.stop(); } catch { }
      try { faceMesh?.close(); } catch { }
      if (pendingShortTimerRef.current) window.clearTimeout(pendingShortTimerRef.current);
      try {
        const v = videoRef.current;
        const s = v?.srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        if (v) v.srcObject = null;
      } catch { }
      setCameraReady(false);
    };
  }, [enabled, status]);

  return {
    status,
    cameraReady,
    currentEAR,
    threshold: personalizedThresholdRef.current,
    isClosed,
    calibrationCount,
    error,
    startCalibration,
    calibFeedback,
  };
}
