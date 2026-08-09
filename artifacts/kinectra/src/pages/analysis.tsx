import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  StopCircle,
  Zap,
  BarChart2,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSessionContext } from "@/contexts/SessionContext";
import { useEndSession } from "@workspace/api-client-react";
import { useKinectraAnalysis } from "@/hooks/use-kinectra-analysis";
import { useAuth } from "@/context/auth_context";

export default function Analysis() {
  const [, setLocation] = useLocation();
  const { config } = useSessionContext();
  const { toast } = useToast();
  const { user } = useAuth();
  const isGuest = user?.id === "guest";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const cameraInitialisedRef = useRef(false);

  const { isModelLoading, modelError, metrics, startAnalysis, stopAnalysis } =
    useKinectraAnalysis(config.analysisType, config.dominantHand);

  // ── Temporal Low-Pass Filtering (EMA) ──
  const [smoothedMetrics, setSmoothedMetrics] = useState({
    elbowAngle: 0,
    kneeAngle: 0,
    spineTilt: 0,
    shoulderAlignment: 0,
    balanceScore: 100,
    techniqueScore: 100,
    warnings: [] as string[],
  });

  useEffect(() => {
    if (!isModelLoading) {
      const alpha = 0.35; // smoothing coefficient
      setSmoothedMetrics((prev) => {
        const smoothedElbow = prev.elbowAngle === 0 ? metrics.elbowAngle : Math.round(alpha * metrics.elbowAngle + (1 - alpha) * prev.elbowAngle);
        const smoothedKnee = prev.kneeAngle === 0 ? metrics.kneeAngle : Math.round(alpha * metrics.kneeAngle + (1 - alpha) * prev.kneeAngle);
        const smoothedSpine = prev.spineTilt === 0 ? metrics.spineTilt : Math.round(alpha * metrics.spineTilt + (1 - alpha) * prev.spineTilt);
        const smoothedShoulder = prev.shoulderAlignment === 0 ? metrics.shoulderAlignment : Math.round(alpha * metrics.shoulderAlignment + (1 - alpha) * prev.shoulderAlignment);
        const smoothedBalance = Math.round(alpha * metrics.balanceScore + (1 - alpha) * prev.balanceScore);
        const smoothedTechnique = Math.round(alpha * metrics.techniqueScore + (1 - alpha) * prev.techniqueScore);

        return {
          elbowAngle: smoothedElbow,
          kneeAngle: smoothedKnee,
          spineTilt: smoothedSpine,
          shoulderAlignment: smoothedShoulder,
          balanceScore: smoothedBalance,
          techniqueScore: smoothedTechnique,
          warnings: metrics.warnings,
        };
      });
    }
  }, [metrics, isModelLoading]);

  const [snapshots, setSnapshots] = useState<{ src: string; label: string; time: string; category: "deviation" | "optimal" }[]>([]);
  const [showGlowPulse, setShowGlowPulse] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [spokenText, setSpokenText] = useState("Optimal mechanics detected. Stance is stable.");
  const [activeSuggestion, setActiveSuggestion] = useState(() => {
    return config.analysisType === "bowling" ? "Start Bowling Stance" : "Start Batting Stance";
  });
  const [isMuted, setIsMuted] = useState(() => {
    return sessionStorage.getItem("kinectra_coach_muted") === "true";
  });


  useEffect(() => {
    sessionStorage.setItem("kinectra_coach_muted", String(isMuted));
    if (isMuted && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [isMuted]);

  const endSessionMutation = useEndSession();
  const [frameCount, setFrameCount] = useState(0);

  const statsRef = useRef({
    frames: 0,
    postureSum: 0,
    alignmentSum: 0,
    stabilitySum: 0,
    efficiencySum: 0,
  });

  const lastCapturedTimeRef = useRef<number>(0);
  const lastStateRef = useRef<{
    lastElbowAngle: number;
    lastSpineTilt: number;
    lastKneeAngle: number;
  }>({ lastElbowAngle: 0, lastSpineTilt: 0, lastKneeAngle: 0 });

  // Peak-Reversal (Inflection Point) History logs
  const elbowHistoryRef = useRef<number[]>([]);
  const spineHistoryRef = useRef<number[]>([]);
  const kneeHistoryRef = useRef<number[]>([]);

  // Blends webcam video feed and pose skeleton canvas onto an offline context
  const captureSnapshot = useCallback((eventLabel: string) => {
    if (canvasRef.current && videoRef.current) {
      try {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        let w = video.videoWidth;
        let h = video.videoHeight;
        let isMock = false;
        
        if (!w || !h || video.readyState < 2) {
          w = 640;
          h = 480;
          isMock = true;
        }
        
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = w;
        tempCanvas.height = h;
        
        const tCtx = tempCanvas.getContext("2d");
        if (tCtx) {
          // Hardware-accelerated sharpening filters to heighten edge clarity and skeletal margins
          tCtx.filter = "contrast(1.08) brightness(1.02) saturate(1.05)";
          
          if (isMock) {
            // Draw a high-fidelity dark sports telemetry backdrop for mock testing
            tCtx.fillStyle = "#090d16";
            tCtx.fillRect(0, 0, w, h);
            
            // Draw biomechanical telemetry grid lines
            tCtx.strokeStyle = "rgba(14, 165, 233, 0.15)";
            tCtx.lineWidth = 1;
            for (let x = 40; x < w; x += 40) {
              tCtx.beginPath(); tCtx.moveTo(x, 0); tCtx.lineTo(x, h); tCtx.stroke();
            }
            for (let y = 40; y < h; y += 40) {
              tCtx.beginPath(); tCtx.moveTo(0, y); tCtx.lineTo(w, y); tCtx.stroke();
            }
            
            // Telemetry alignment logs omitted for clean visual snapshots
            
            // Draw a stick figure skeleton
            tCtx.strokeStyle = "#0ea5e9";
            tCtx.lineWidth = 4;
            tCtx.lineCap = "round";
            // Head
            tCtx.beginPath(); tCtx.arc(w / 2, 140, 22, 0, Math.PI * 2); tCtx.stroke();
            // Spine
            tCtx.beginPath(); tCtx.moveTo(w / 2, 162); tCtx.lineTo(w / 2, 280); tCtx.stroke();
            // Shoulders
            tCtx.beginPath(); tCtx.moveTo(w / 2 - 50, 190); tCtx.lineTo(w / 2 + 50, 190); tCtx.stroke();
            // Hips
            tCtx.beginPath(); tCtx.moveTo(w / 2 - 30, 280); tCtx.lineTo(w / 2 + 30, 280); tCtx.stroke();
            // Joints
            tCtx.strokeStyle = "#e11d48";
            tCtx.beginPath(); tCtx.arc(w / 2 - 50, 190, 5, 0, Math.PI * 2); tCtx.stroke();
            tCtx.beginPath(); tCtx.arc(w / 2 + 50, 190, 5, 0, Math.PI * 2); tCtx.stroke();
          } else {
            // Mirror context for camera matches
            tCtx.translate(w, 0);
            tCtx.scale(-1, 1);
            tCtx.drawImage(video, 0, 0, w, h);
          }
          
          if (!isMock) {
            tCtx.drawImage(canvas, 0, 0, w, h);
          }
          
          const dataUrl = tempCanvas.toDataURL("image/webp", 0.7);
          const elapsed = `${Math.floor(frameCount)}s`;
          
          // Set optimal category and use the objective athletic event name as displayLabel
          const category: "deviation" | "optimal" = "optimal";
          const displayLabel = eventLabel === "Stance Balance" ? "Stance Check" : eventLabel;
          
          setSnapshots((prev) => {
            const updated = [...prev, { 
              src: dataUrl, 
              label: displayLabel, 
              time: elapsed, 
              category,
              metrics: {
                elbowAngle: Math.round(smoothedMetrics.elbowAngle),
                spineTilt: Math.round(smoothedMetrics.spineTilt),
                kneeAngle: Math.round(smoothedMetrics.kneeAngle),
                shoulderAlignment: Math.round(smoothedMetrics.shoulderAlignment)
              }
            }];
            if (config.sessionId && !isGuest) {
              try {
                sessionStorage.setItem(`kinectra_snapshots_${config.sessionId}`, JSON.stringify(updated));
              } catch (quotaError) {
                console.warn("sessionStorage quota exceeded, keeping snapshots in memory:", quotaError);
              }
            }
            return updated;
          });

          // Update Next Suggestion based on current movement phase
          if (config.analysisType === "bowling") {
            if (eventLabel === "Bowling Stance") setActiveSuggestion("Proceed to Setup Load");
            else if (eventLabel === "Setup Load") setActiveSuggestion("Execute Landing Plant");
            else if (eventLabel === "Landing Plant") setActiveSuggestion("Reach Bowling Release");
            else if (eventLabel === "Bowling Release") setActiveSuggestion("Complete Delivery Drive");
            else if (eventLabel === "Delivery Drive") setActiveSuggestion("Start Bowling Stance");
          } else {
            if (eventLabel === "Stance Setup") setActiveSuggestion("Begin High Backlift");
            else if (eventLabel === "High Backlift") setActiveSuggestion("Execute Front-foot Drive");
            else if (eventLabel === "Front-foot Drive") setActiveSuggestion("Complete Follow-through");
            else if (eventLabel === "Follow-through") setActiveSuggestion("Start Batting Stance");
          }
          
          // Stealth pulse feedback (emerald glowing card border instead of full screen flash)

          setShowGlowPulse(true);
          setTimeout(() => setShowGlowPulse(false), 350);

          toast({
            title: `🎯 ${eventLabel} Captured`,
            description: `Movement freeze frame logged at ${elapsed}.`,
          });
        }
      } catch (e) {
        console.error("Failed to capture snapshot frame", e);
      }
    }
  }, [config.sessionId, config.dominantHand, frameCount, toast, smoothedMetrics]);

  // Hook to monitor smoothed metrics and trigger snapshot capture on peak events (3-Frame Sliding Window)
  useEffect(() => {
    const { elbowAngle, spineTilt, kneeAngle, shoulderAlignment } = smoothedMetrics;
    const now = Date.now();
    
    // Cooldown check (minimum 2.2s spacing to capture quick sequential movements)
    if (now - lastCapturedTimeRef.current < 2200) return;

    // 1. Maintain sliding window of metrics histories
    elbowHistoryRef.current.push(elbowAngle);
    if (elbowHistoryRef.current.length > 3) elbowHistoryRef.current.shift();

    spineHistoryRef.current.push(spineTilt);
    if (spineHistoryRef.current.length > 3) spineHistoryRef.current.shift();

    kneeHistoryRef.current.push(kneeAngle);
    if (kneeHistoryRef.current.length > 3) kneeHistoryRef.current.shift();

    // 2. Perform peak-reversal inflection point checks across 4 athletic phases
    let triggerAction = false;
    let eventLabel = "";

    if (config.analysisType === "bowling") {
      // 0. Bowling Stance (Bowler starting stance position)
      if (elbowHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = elbowHistoryRef.current;
        // Trough check: elbow holds bent loading position stably at setup (seated friendly)
        const isStance = v1 > 45 && v1 < 105 && v1 < v0 - 3.0 && v2 > v1 + 3.0;
        if (isStance) {
          triggerAction = true;
          eventLabel = "Bowling Stance";
          elbowHistoryRef.current = [];
        }
      }

      // 1. Setup Load (Elbow flexion peak in cocked position)
      if (elbowHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = elbowHistoryRef.current;
        // Require a 4.5-degree inflection change to avoid noise triggers
        const isSetup = v1 > 40 && v1 < 90 && spineTilt < 10 && v1 < v0 - 4.5 && v2 > v1 + 4.5;
        if (isSetup) {
          triggerAction = true;
          eventLabel = "Setup Load";
          elbowHistoryRef.current = [];
        }
      }

      // 2. Landing Plant (Knee flexion plant impact)
      if (kneeHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = kneeHistoryRef.current;
        const isPlant = v1 > 100 && v1 <= 145 && v1 < v0 - 4.0 && v2 > v1 + 4.0;
        if (isPlant) {
          triggerAction = true;
          eventLabel = "Landing Plant";
          kneeHistoryRef.current = [];
        }
      }

      // 3. Bowling Release Point (Peak Arm Extension)
      if (elbowHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = elbowHistoryRef.current;
        const isPeak = v1 >= 148 && v1 > v0 + 4.5 && v2 < v1 - 4.5;
        if (isPeak) {
          triggerAction = true;
          eventLabel = "Bowling Release";
          elbowHistoryRef.current = [];
        }
      }

      // 4. Delivery Drive (Peak Spine Forward Tilt)
      if (spineHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = spineHistoryRef.current;
        const isPeak = v1 >= 18 && v1 > v0 + 3.0 && v2 < v1 - 3.0;
        if (isPeak) {
          triggerAction = true;
          eventLabel = "Delivery Drive";
          spineHistoryRef.current = [];
        }
      }
    } else {
      // 1. Stance Setup (Balanced crouched waiting stance)
      if (kneeHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = kneeHistoryRef.current;
        const isSetupStance = v1 >= 135 && v1 <= 150 && spineTilt >= 12 && spineTilt <= 18 && v1 < v0 - 3.5 && v2 > v1 + 3.5;
        if (isSetupStance) {
          triggerAction = true;
          eventLabel = "Stance Setup";
          kneeHistoryRef.current = [];
        }
      }

      // 2. High Backlift (Peak of shoulder rotation / bat lift)
      if (elbowHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = elbowHistoryRef.current;
        const isBacklift = v1 > 40 && v1 < 90 && shoulderAlignment > 15 && v1 < v0 - 4.0 && v2 > v1 + 4.0;
        if (isBacklift) {
          triggerAction = true;
          eventLabel = "High Backlift";
          elbowHistoryRef.current = [];
        }
      }

      // 3. Contact Flexion (Front-foot Drive Lunge apex)
      if (kneeHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = kneeHistoryRef.current;
        const isTrough = v1 > 0 && v1 <= 135 && v1 < v0 - 4.5 && v2 > v1 + 4.5;
        if (isTrough) {
          triggerAction = true;
          eventLabel = "Front-foot Drive";
          kneeHistoryRef.current = [];
        }
      }

      // 4. Follow-through (Spine recovery to upright post-lunge)
      if (spineHistoryRef.current.length === 3 && !triggerAction) {
        const [v0, v1, v2] = spineHistoryRef.current;
        const isFollowThrough = v1 < 10 && v1 < v0 - 3.0 && v2 > v1 + 3.0;
        if (isFollowThrough) {
          triggerAction = true;
          eventLabel = "Follow-through";
          spineHistoryRef.current = [];
        }
      }
    }

    lastStateRef.current = {
      lastElbowAngle: elbowAngle,
      lastSpineTilt: spineTilt,
      lastKneeAngle: kneeAngle,
    };

    if (triggerAction) {
      lastCapturedTimeRef.current = now;
      // 100ms settling buffer to let camera exposure adapt to peak posture stability and clear motion blur
      setTimeout(() => {
        captureSnapshot(eventLabel);
      }, 100);
    }
  }, [smoothedMetrics, config.analysisType, captureSnapshot]);

  // ── Camera: initialise ONCE ───────────────────────────────────────
  useEffect(() => {
    if (!config.sessionId) {
      setLocation("/setup");
      return;
    }
    
    // Clear old session snapshots from sessionStorage to free up browser quota space
    try {
      const currentKey = `kinectra_snapshots_${config.sessionId}`;
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("kinectra_snapshots_") && key !== currentKey) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (e) {
      console.warn("Failed to clean up sessionStorage keys:", e);
    }

    if (cameraInitialisedRef.current) return;
    cameraInitialisedRef.current = true;

    let active = true;
    let stream: MediaStream | null = null;

    if (config.analysisMode === "upload" && config.videoFileUrl) {
      if (videoRef.current) {
        videoRef.current.src = config.videoFileUrl;
        videoRef.current.loop = true;
        videoRef.current.play().catch(() => {});
        setHasCameraPermission(true);
        setCameraError(null);
      }
      return () => {
        active = false;
        stopAnalysis();
        if (videoRef.current) {
          videoRef.current.src = "";
        }
        cameraInitialisedRef.current = false;
      };
    }

    async function setupCamera() {
      try {
        // 1. Attempt ideal high-definition sports analysis feed
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          });
        } catch (hdErr) {
          console.warn("HD video constraints failed, retrying with fallback...", hdErr);
          // 2. Fallback to general video stream if constraints fail
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
          setHasCameraPermission(true);
          setCameraError(null);
        }
      } catch (err: any) {
        if (active) {
          console.error("Webcam getUserMedia call failed:", err);
          setCameraError(err?.name || "Error");
          setHasCameraPermission(false);
        }
      }
    }

    setupCamera();

    return () => {
      active = false;
      stopAnalysis();
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      cameraInitialisedRef.current = false;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.analysisMode, config.videoFileUrl]); // intentionally empty — run once on mount

  // ── Start pose detection once camera + model ready ─────────────────
  useEffect(() => {
    if (hasCameraPermission && !isModelLoading && videoRef.current && canvasRef.current) {
      startAnalysis(videoRef.current, canvasRef.current);
    }
  }, [hasCameraPermission, isModelLoading, startAnalysis]);

  // ── Speech Alerts Engine (Uses Smoothed Telemetry) ────────────────
  const lastSpokenRef = useRef<Record<string, number>>({});
  const audioCacheRef = useRef<Record<string, HTMLAudioElement>>({});
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const playSpeechText = (text: string) => {
    if (isMuted) return;

    // Cancel any currently playing speech audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }

    setIsSpeaking(true);

    if (audioCacheRef.current[text]) {
      const audio = audioCacheRef.current[text];
      currentAudioRef.current = audio;
      audio.currentTime = 0;
      audio.play().catch((err) => {
        console.warn("Failed to play cached audio:", err);
        setIsSpeaking(false);
      });
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      return;
    }

    // Generate url for Rime backend proxy
    const API_BASE_URL = import.meta.env.VITE_API_URL || "";
    const audioUrl = `${API_BASE_URL}/api/session/speech/synthesize?text=${encodeURIComponent(text)}`;
    const audio = new Audio(audioUrl);
    currentAudioRef.current = audio;
    audioCacheRef.current[text] = audio;

    audio.play().then(() => {
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
    }).catch((err) => {
      console.warn("Rime speech playing failed, falling back to window.speechSynthesis:", err);
      // Fallback to local browser synthesis
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.05;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } else {
        setIsSpeaking(false);
      }
    });
  };

  useEffect(() => {
    if (smoothedMetrics.warnings && smoothedMetrics.warnings.length > 0) {
      const activeWarning = smoothedMetrics.warnings[0];
      const now = Date.now();
      const lastSpokenTime = lastSpokenRef.current[activeWarning] || 0;
      
      if (now - lastSpokenTime >= 6000) {
        let alertText = activeWarning;
        if (activeWarning === "Excessive spine tilt") {
          alertText = "Keep your spine tall and straight.";
        } else if (activeWarning === "Elbow angle too low") {
          alertText = "Elbow is dropping. Keep it at 160 degrees or above at release.";
        } else if (activeWarning === "Front knee bent too much") {
          alertText = "Stabilize your front landing leg.";
        } else if (activeWarning === "Head moving excessively") {
          alertText = "Keep your head still, watch the ball.";
        } else if (activeWarning === "Balance unstable") {
          alertText = "Focus on balance and plant your landing stride.";
        }
        
        setSpokenText(alertText);
        playSpeechText(alertText);
        lastSpokenRef.current[activeWarning] = now;
      }
    } else {
      // Optimal posture periodic verification comment
      const now = Date.now();
      const lastSpokenTime = lastSpokenRef.current["optimal"] || 0;
      if (now - lastSpokenTime >= 12000 && !isModelLoading && hasCameraPermission) {
        const text = "Optimal mechanics detected. Keep maintaining this posture.";
        setSpokenText(text);
        playSpeechText(text);
        lastSpokenRef.current["optimal"] = now;
      }
    }
  }, [smoothedMetrics.warnings, isModelLoading, hasCameraPermission, isMuted]);

  // Keep a ref of the latest metrics to avoid resetting the interval
  const metricsRef = useRef(smoothedMetrics);
  useEffect(() => {
    metricsRef.current = smoothedMetrics;
  }, [smoothedMetrics]);

  // ── Accumulate stats (once per second rather than every metric change) ──
  const accumulateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isModelLoading && hasCameraPermission) {
      accumulateRef.current = setInterval(() => {
        setFrameCount(f => f + 1);
        statsRef.current.frames += 1;
        statsRef.current.postureSum += metricsRef.current.spineTilt > 30 ? 50 : 90;
        statsRef.current.alignmentSum += metricsRef.current.shoulderAlignment < 10 ? 95 : 60;
        statsRef.current.stabilitySum += metricsRef.current.balanceScore;
        statsRef.current.efficiencySum += metricsRef.current.techniqueScore;
      }, 1000);
    }
    return () => { if (accumulateRef.current) clearInterval(accumulateRef.current); };
  }, [isModelLoading, hasCameraPermission]);

  const handleEndSession = useCallback(() => {
    if (!config.sessionId) return;
    stopAnalysis();
    const n = Math.max(1, statsRef.current.frames);
    const avgPosture = Math.round(statsRef.current.postureSum / n);
    const avgAlignment = Math.round(statsRef.current.alignmentSum / n);
    const avgStability = Math.round(statsRef.current.stabilitySum / n);
    const avgEfficiency = Math.round(statsRef.current.efficiencySum / n);
    const overallScore = Math.round(
      avgPosture * 0.3 + avgAlignment * 0.25 + avgStability * 0.25 + avgEfficiency * 0.2
    );
    endSessionMutation.mutate(
      {
        sessionId: config.sessionId,
        data: {
          frameCount: statsRef.current.frames,
          avgPostureScore: avgPosture,
          avgAlignmentScore: avgAlignment,
          avgStabilityScore: avgStability,
          avgEfficiencyScore: avgEfficiency,
          overallScore,
          warnings: smoothedMetrics.warnings,
          snapshots: isGuest ? [] : (snapshots as any),
        },
      },
      {
        onSuccess: () => setLocation(`/results/${config.sessionId}`),
        onError: () => toast({ variant: "destructive", title: "Error ending session", description: "Failed to save session data." }),
      }
    );
  }, [config.sessionId, stopAnalysis, endSessionMutation, smoothedMetrics.warnings, setLocation, toast, isGuest]);


  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#060b13] text-white overflow-hidden">

      {/* ── Header ── */}
      <header className="h-16 flex items-center justify-between px-6 bg-slate-900 border-b border-slate-800 z-10 shrink-0">
        <div className="flex flex-col">
          <span className="font-extrabold tracking-wider text-sm text-white">KINECTRA LABS</span>
          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none mt-0.5">
            Autonomous Coaching Hub
          </span>
        </div>

        {/* Center Stats Pills */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/60 border border-slate-800 rounded-md font-mono text-[10px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>ATHLETE: <strong className="text-white">{config.athleteName || "ug"}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/60 border border-slate-800 rounded-md font-mono text-[10px] text-slate-400">
            <span>DISCIPLINE: <strong className="text-orange-500">{config.analysisType === "bowling" ? "Bowling" : "Batting"}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/60 border border-slate-800 rounded-md font-mono text-[10px] text-slate-400">
            <span>TIME: <strong className="text-white">{formatTime(frameCount)}</strong></span>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={handleEndSession}
          disabled={endSessionMutation.isPending}
          className="gap-1.5 font-bold text-xs rounded-full px-4 shrink-0 bg-red-600 hover:bg-red-700"
        >
          {endSessionMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <StopCircle className="h-3.5 w-3.5" />
          )}
          End Session
        </Button>
      </header>

      {/* ── Main Layout: Split Screen ── */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 p-6 min-h-0 bg-[#060b13] overflow-y-auto">
        
        {/* Left Side: Live Player Feed */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
            <Camera className="h-4 w-4 text-orange-500" />
            <span>Live Player Feed</span>
          </div>
          
          <div className={`relative w-full aspect-video bg-slate-950 border rounded-xl overflow-hidden transition-all duration-300 flex items-center justify-center ${showGlowPulse ? 'border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.4)] scale-[1.002]' : 'border-slate-800 shadow-2xl'}`}>

            {/* Overlays for loading / error states */}
            {hasCameraPermission === false && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950 text-gray-400 p-8 text-center z-20">
                <Camera className="h-12 w-12 mb-4 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-200 mb-2">Camera Access Required</h3>
                <p className="max-w-sm text-sm mb-4">
                  KINECTRA runs pose analysis entirely in your browser — your video never leaves your device.
                </p>
                {cameraError === "NotReadableError" ? (
                  <p className="max-w-xs text-xs text-orange-400 bg-orange-400/10 border border-orange-500/20 px-3 py-2 rounded-lg font-mono">
                    ⚠️ Webcam is blocked or in use by another tab or app (e.g. Zoom, Teams, or browser developer tools). Please close other tabs/apps and refresh.
                  </p>
                ) : cameraError === "NotAllowedError" || cameraError === "PermissionDeniedError" ? (
                  <p className="max-w-xs text-xs text-red-400 bg-red-400/10 border border-red-500/20 px-3 py-2 rounded-lg font-mono">
                    ❌ Permission Denied. Please click the camera icon in your browser address bar to allow camera access, then reload.
                  </p>
                ) : cameraError === "NotFoundError" || cameraError === "DevicesNotFoundError" ? (
                  <p className="max-w-xs text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 rounded-lg font-mono">
                    🔌 No camera device detected on this system.
                  </p>
                ) : (
                  <p className="max-w-xs text-xs text-slate-500 bg-slate-900 border border-slate-800 px-3 py-2 rounded-lg font-mono">
                    Error code: {cameraError || "Unknown Access Error"}
                  </p>
                )}
              </div>
            )}
            {isModelLoading && hasCameraPermission !== false && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/80 backdrop-blur-sm text-gray-200 z-20 gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <h3 className="text-base font-medium tracking-tight">Initialising Vision Engine</h3>
                <p className="text-sm text-gray-500">Loading WASM modules & weights…</p>
              </div>
            )}
            {modelError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 text-red-400 z-20 gap-3">
                <AlertCircle className="h-10 w-10" />
                <p className="text-sm text-center max-w-xs">{modelError}</p>
              </div>
            )}

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-contain ${config.analysisMode === "upload" ? "" : "scale-x-[-1]"}`}
            />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full object-contain z-10 pointer-events-none ${config.analysisMode === "upload" ? "" : "scale-x-[-1]"}`}
            />

            {/* Corner reticle */}
            <div className="absolute inset-0 pointer-events-none m-4 z-20 flex flex-col justify-between">
              <div className="flex justify-between">
                <div className="w-6 h-6 border-l-2 border-t-2 border-primary/60 rounded-tl" />
                <div className="w-6 h-6 border-r-2 border-t-2 border-primary/60 rounded-tr" />
              </div>
              <div className="flex justify-between">
                <div className="w-6 h-6 border-l-2 border-b-2 border-primary/60 rounded-bl" />
                <div className="w-6 h-6 border-r-2 border-b-2 border-primary/60 rounded-br" />
              </div>
            </div>

            {/* Scan line effect */}
            {!isModelLoading && hasCameraPermission && (
              <motion.div
                className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent z-20 pointer-events-none"
                animate={{ top: ["10%", "90%", "10%"] }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              />
            )}
          </div>
          
          <p className="text-[9px] font-mono text-center text-slate-500 uppercase tracking-widest mt-1">
            Real-time client-side coordinate mapping overlaid.
          </p>
        </div>

        {/* Right Side: AI Coach Avatar */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="flex items-center justify-between text-xs font-bold text-white uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-orange-500" />
              <span>AI Coach Avatar</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(prev => !prev)}
                className={`h-7 w-7 rounded-full transition-all duration-300 ${isMuted ? 'text-red-500 bg-red-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                title={isMuted ? "Unmute Coach Voice" : "Mute Coach Voice"}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <span className="text-[9px] font-mono text-slate-500 tracking-normal font-medium">COACH ARYAN (ACTIVE)</span>
            </div>
          </div>

          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-6 shadow-2xl flex flex-col items-center justify-center gap-4 relative min-h-[280px]">
            {/* Upper Left Suggestion Overlay */}
            <div className="absolute top-3.5 left-3.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-500 text-[10px] font-mono uppercase tracking-wider font-semibold z-10 shadow-inner">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 relative flex">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
              </span>
              <span>Next: {activeSuggestion}</span>
            </div>

            {/* Animated Coach SVG */}
            <CoachAvatarSVG isSpeaking={isSpeaking} />

            {/* Translucent voice message bubble */}
            <div className="w-full bg-[#0a0f1d]/80 border border-slate-800 rounded-xl p-4 flex items-start gap-3 mt-2 shadow-inner">
              <Volume2 className={`h-5 w-5 text-red-500 mt-0.5 shrink-0 ${isSpeaking ? 'animate-pulse scale-110' : ''}`} />
              <p className="text-xs text-slate-300 font-medium italic leading-relaxed">
                "{spokenText}"
              </p>
            </div>
          </div>

          <p className="text-[9px] font-mono text-center text-slate-500 uppercase tracking-widest mt-1">
            Avatar animated dynamically in sync with text-to-speech instructions.
          </p>
        </div>
      </div>

      {/* ── Mid Section: Metrics Grid & Action Buttons ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 px-6 py-4 border-t border-slate-900 bg-[#070c16] shrink-0">
        
        {/* Metrics Grid */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricBlock label="Elbow Angle" value={`${smoothedMetrics.elbowAngle}°`} isOrange />
          <MetricBlock label="Knee Angle" value={`${smoothedMetrics.kneeAngle}°`} isOrange />
          <MetricBlock label="Spine Tilt" value={`${smoothedMetrics.spineTilt}°`} isOrange />
          <MetricBlock label="Balance Score" value={`${smoothedMetrics.balanceScore}%`} />
          <MetricBlock label="Form Score" value={`${smoothedMetrics.techniqueScore}/100`} isGreen />
          <MetricBlock label="Injury Risk" isBadge badgeValue={smoothedMetrics.warnings.length >= 2 ? "HIGH" : smoothedMetrics.warnings.length === 1 ? "MEDIUM" : "LOW"} />
        </div>

        {/* Action button stack */}
        <div className="flex flex-col sm:flex-row lg:flex-col gap-3 justify-center items-center">
          <Button
            variant="destructive"
            className="w-full gap-2 font-semibold shadow-md bg-red-600 hover:bg-red-700 relative text-xs py-1"
            onClick={() => {
              toast({
                title: "Active Session Recording",
                description: "Telemetry pose data is being auto-captured automatically.",
              });
            }}
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
            <span>Record Session</span>
          </Button>
          
          <Button
            variant="outline"
            className="w-full gap-2 font-semibold bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800 hover:text-white text-xs py-1"
            onClick={handleEndSession}
          >
            <BarChart2 className="h-3.5 w-3.5 shrink-0" />
            <span>View Analysis Report</span>
          </Button>
        </div>
      </div>

      {/* ── Bottom Section: Auto Snapshot Gallery ── */}
      <div className="px-6 py-4 bg-[#050911] border-t border-slate-900 shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-4 min-h-[110px]">
        <div className="shrink-0 flex flex-col justify-center leading-none text-slate-500 font-mono font-bold tracking-widest text-[9px] uppercase">
          <span>AUTO SNAPSHOT</span>
          <span className="mt-1">GALLERY</span>
        </div>

        <div className="flex-1 flex gap-3 overflow-x-auto pb-1 scrollbar-none">
          {snapshots.length === 0 ? (
            <div className="flex items-center text-[10px] font-mono text-slate-600 italic">
              No snapshots captured yet. Complete a movement to auto-trigger snapshots.
            </div>
          ) : (
            snapshots.map(({ src, label, time }, i) => {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative w-28 rounded-lg overflow-hidden border border-slate-800 bg-black shrink-0 shadow-md group cursor-pointer"
                  onClick={() => {
                    const w = window.open();
                    if (w) {
                      w.document.write(`<img src="${src}" style="width:100%;height:100%;object-fit:contain;background:#000;" />`);
                      w.document.title = `${label} (${time})`;
                    }
                  }}
                >
                  <img src={src} className="w-full aspect-video object-cover" alt={label} />
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function CoachAvatarSVG({ isSpeaking }: { isSpeaking: boolean }) {
  return (
    <svg width="130" height="130" viewBox="0 0 140 140" className="mx-auto select-none">
      {/* Cap crown */}
      <path d="M40 50 C40 30, 100 30, 100 50 Z" fill="#1e293b" />
      
      {/* Visor */}
      <path d="M30 50 C30 46, 110 46, 110 50 C110 54, 30 54, 30 50 Z" fill="#f97316" />
      <path d="M35 50 Q70 60 105 50" stroke="#f97316" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* Ears */}
      <circle cx="34" cy="75" r="8" fill="#fde047" />
      <circle cx="106" cy="75" r="8" fill="#fde047" />

      {/* Face */}
      <circle cx="70" cy="78" r="30" fill="#fef08a" />

      {/* Sunglasses */}
      {/* Left lens */}
      <path d="M44 68 C44 60, 68 60, 68 68 C68 74, 44 74, 44 68 Z" fill="#0f172a" />
      {/* Right lens */}
      <path d="M72 68 C72 60, 96 60, 96 68 C96 74, 72 74, 72 68 Z" fill="#0f172a" />
      {/* Bridge */}
      <rect x="66" y="65" width="8" height="4" fill="#0f172a" />

      {/* Mouth */}
      <motion.ellipse
        cx="70"
        cy="92"
        rx="8"
        animate={{ ry: isSpeaking ? [2, 9, 2] : 2.5 }}
        transition={{ repeat: Infinity, duration: 0.35, ease: "easeInOut" }}
        fill="#0f172a"
      />

      {/* Collar neck line */}
      <path d="M50 112 Q70 122 90 112" stroke="#f97316" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function MetricBlock({
  label,
  value,
  isOrange,
  isGreen,
  isBadge,
  badgeValue,
}: {
  label: string;
  value?: string;
  isOrange?: boolean;
  isGreen?: boolean;
  isBadge?: boolean;
  badgeValue?: "LOW" | "MEDIUM" | "HIGH";
}) {
  const valueColor = isOrange 
    ? "text-orange-500" 
    : isGreen 
      ? "text-emerald-400" 
      : "text-white";

  const badgeColor = badgeValue === "HIGH" 
    ? "bg-red-500/10 border-red-500/30 text-red-400" 
    : badgeValue === "MEDIUM" 
      ? "bg-orange-500/10 border-orange-500/30 text-orange-400" 
      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";

  return (
    <div className="bg-[#0f172a]/60 border border-slate-800 rounded-xl p-3 flex flex-col justify-between min-h-[75px] shadow-sm">
      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{label}</span>
      {isBadge ? (
        <span className={`inline-block w-fit px-2.5 py-0.5 rounded-full border text-[10px] font-bold mt-1 ${badgeColor}`}>
          {badgeValue}
        </span>
      ) : (
        <span className={`text-xl font-bold tracking-tight font-mono mt-1 ${valueColor}`}>
          {value}
        </span>
      )}
    </div>
  );
}
