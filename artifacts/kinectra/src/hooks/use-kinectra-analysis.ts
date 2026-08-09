import { useEffect, useRef, useState, useCallback } from "react";
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import { SessionInputAnalysisType } from "@workspace/api-client-react";

interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface KinectraMetrics {
  elbowAngle: number;
  kneeAngle: number;
  shoulderAlignment: number;
  spineTilt: number;
  headStability: number;
  balanceScore: number;
  techniqueScore: number;
  warnings: string[];
  bodyDetected: boolean;
}

export interface KinectraAnalysisResult {
  isModelLoading: boolean;
  modelError: string | null;
  metrics: KinectraMetrics;
  startAnalysis: (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => void;
  stopAnalysis: () => void;
}

const DEFAULT_METRICS: KinectraMetrics = {
  elbowAngle: 0,
  kneeAngle: 0,
  shoulderAlignment: 0,
  spineTilt: 0,
  headStability: 100,
  balanceScore: 100,
  techniqueScore: 100,
  warnings: [],
  bodyDetected: false,
};

function calculateAngle(a: Vector3D, b: Vector3D, c: Vector3D): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
  if (mag1 === 0 || mag2 === 0) return 0;
  const clamped = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(clamped) * 180.0) / Math.PI;
}

export function useKinectraAnalysis(
  analysisType: SessionInputAnalysisType,
  dominantHand: string
): KinectraAnalysisResult {
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<KinectraMetrics>(DEFAULT_METRICS);

  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const graphDeadRef = useRef(false); // true after an unrecoverable MediaPipe graph error
  // Throttle: track when we last ran inference
  const lastInferenceTimeRef = useRef(0);
  const FPS_INTERVAL = 1000 / 15; // 15 fps

  // Load model once
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (!cancelled) {
          poseLandmarkerRef.current = landmarker;
          setIsModelLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setModelError("Failed to load vision model. Check your network connection.");
          setIsModelLoading(false);
        }
      }
    }
    init();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (poseLandmarkerRef.current) {
        try { poseLandmarkerRef.current.close(); } catch (_) {}
        poseLandmarkerRef.current = null;
      }
    };
  }, []); // intentionally empty — model loaded once per mount

  const analyzePose = useCallback(
    (landmarks: any[]) => {
      if (!landmarks || landmarks.length === 0) {
        setMetrics((prev) => ({
          ...prev,
          bodyDetected: false
        }));
        return;
      }
      const pose = landmarks[0];
      const isRight = dominantHand === "right";

      const nose = pose[0];
      const lShoulder = pose[11], rShoulder = pose[12];
      const lElbow = pose[13], rElbow = pose[14];
      const lWrist = pose[15], rWrist = pose[16];
      const lHip = pose[23], rHip = pose[24];
      const lKnee = pose[25], rKnee = pose[26];
      const lAnkle = pose[27], rAnkle = pose[28];

      const shoulder = isRight ? rShoulder : lShoulder;
      const elbow = isRight ? rElbow : lElbow;
      const wrist = isRight ? rWrist : lWrist;
      const hip = isRight ? rHip : lHip;
      const knee = isRight ? rKnee : lKnee;
      const ankle = isRight ? rAnkle : lAnkle;

      const elbowAngle = calculateAngle(shoulder, elbow, wrist);
      const kneeAngle = calculateAngle(hip, knee, ankle);

      const midHip = {
        x: (lHip.x + rHip.x) / 2,
        y: (lHip.y + rHip.y) / 2,
        z: (lHip.z + rHip.z) / 2,
      };
      const midShoulder = {
        x: (lShoulder.x + rShoulder.x) / 2,
        y: (lShoulder.y + rShoulder.y) / 2,
        z: (lShoulder.z + rShoulder.z) / 2,
      };
      const verticalAboveHip = { x: midHip.x, y: midHip.y - 1, z: midHip.z };
      const spineTilt = calculateAngle(verticalAboveHip, midHip, midShoulder);
      const shoulderAlignment = Math.abs(
        calculateAngle(rShoulder, lShoulder, {
          x: rShoulder.x,
          y: lShoulder.y,
          z: lShoulder.z,
        })
      );

      const hipLevel = Math.abs(lHip.y - rHip.y);
      const balanceScore = Math.max(0, Math.min(100, 100 - hipLevel * 500));

      const warnings: string[] = [];
      let techniqueScore = 100;

      if (analysisType === "bowling") {
        // Legal extension check (optimal release arm should be almost straight: 165°–180°)
        const elbowScore = Math.max(0, 100 - Math.max(0, 165 - elbowAngle) * 3);
        if (elbowAngle < 150) warnings.push("Illegal elbow flexion (Chucking risk)");

        // Front knee brace check (optimal landing knee should be firm: 145°–165°)
        const kneeScore = Math.max(0, 100 - Math.max(0, 145 - kneeAngle) * 2.5);
        if (kneeAngle < 130) warnings.push("Collapsed front landing knee");

        // Spine tilt check (optimal lateral lean for shoulder release: 5°–22°)
        let spineScore = 100;
        if (spineTilt > 22) {
          spineScore = Math.max(0, 100 - (spineTilt - 22) * 4);
          warnings.push("Excessive lateral spine tilt");
        } else if (spineTilt < 5) {
          spineScore = 90;
        }

        // Shoulder alignment check (should rot deviation < 15°)
        const shoulderScore = Math.max(0, 100 - Math.max(0, shoulderAlignment - 15) * 3.5);
        if (shoulderAlignment > 25) warnings.push("Poor shoulder rotation");

        techniqueScore =
          balanceScore * 0.2 +
          elbowScore * 0.3 +
          kneeScore * 0.2 +
          spineScore * 0.2 +
          shoulderScore * 0.1;
      } else {
        if (kneeAngle < 120) warnings.push("Front knee bent too much");
        if (elbowAngle < 90) warnings.push("Low bat lift");
        techniqueScore =
          balanceScore * 0.3 +
          Math.max(0, 100 - Math.abs(kneeAngle - 150) * 0.5) * 0.3 +
          Math.max(0, 100 - spineTilt * 2) * 0.2 +
          Math.max(0, 100 - shoulderAlignment * 2) * 0.2;
      }

      setMetrics({
        elbowAngle: Math.round(elbowAngle),
        kneeAngle: Math.round(kneeAngle),
        shoulderAlignment: Math.round(shoulderAlignment),
        spineTilt: Math.round(spineTilt),
        headStability: 95,
        balanceScore: Math.round(balanceScore),
        techniqueScore: Math.max(0, Math.min(100, Math.round(techniqueScore))),
        warnings,
        bodyDetected: true,
      });
    },
    [analysisType, dominantHand]
  );

  const startAnalysis = useCallback(
    (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => {
      if (!poseLandmarkerRef.current) return;
      if (isRunningRef.current) return; // already running — don't double-start

      isRunningRef.current = true;
      const ctx = canvasElement.getContext("2d");
      if (!ctx) return;
      const drawingUtils = new DrawingUtils(ctx);

      const loop = () => {
        if (!isRunningRef.current) return;

        const now = performance.now();

        // Guard: video must be playing and have real dimensions
        const ready =
          videoElement.readyState >= 2 &&
          videoElement.videoWidth > 0 &&
          videoElement.videoHeight > 0 &&
          !videoElement.paused &&
          (videoElement.srcObject !== null || videoElement.src !== "");

        if (ready) {
          // Sync canvas size to video
          if (
            canvasElement.width !== videoElement.videoWidth ||
            canvasElement.height !== videoElement.videoHeight
          ) {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
          }

          // Only infer when frame changed AND throttle to 15 fps
          const frameChanged = videoElement.currentTime !== lastVideoTimeRef.current;
          const throttleOk = now - lastInferenceTimeRef.current >= FPS_INTERVAL;

          if (frameChanged && throttleOk && !graphDeadRef.current) {
            lastVideoTimeRef.current = videoElement.currentTime;
            lastInferenceTimeRef.current = now;

            try {
              const result = poseLandmarkerRef.current!.detectForVideo(
                videoElement,
                now
              );
              ctx.save();
              ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
              if (result.landmarks && result.landmarks.length > 0) {
                for (const landmark of result.landmarks) {
                  drawingUtils.drawConnectors(
                    landmark,
                    PoseLandmarker.POSE_CONNECTIONS,
                    { color: "#22c55e", lineWidth: 3 }
                  );
                  drawingUtils.drawLandmarks(landmark, {
                    color: "#ffffff",
                    lineWidth: 1,
                    radius: 3,
                  });
                }
                analyzePose(result.landmarks);
              }
              ctx.restore();
            } catch (e) {
              // MediaPipe graph entered error state — stop inference,
              // wait for the video to stabilise, then reset so we try again.
              graphDeadRef.current = true;
              lastVideoTimeRef.current = -1;
              // Allow a short recovery window before re-enabling inference
              setTimeout(() => { graphDeadRef.current = false; }, 500);
            }
          }
        }

        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    },
    [analyzePose, FPS_INTERVAL]
  );

  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  return { isModelLoading, modelError, metrics, startAnalysis, stopAnalysis };
}
