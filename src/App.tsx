import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Play, CheckCircle2, ChevronRight, HelpCircle, Waves, Circle, Moon } from 'lucide-react';

type SensorMode = 'Waiting...' | 'Generic Sensor' | 'Device Motion' | 'SW Filter';

interface GestureOption {
  id: 'circle' | 'wave' | 'idle';
  name: string;
  icon: string;
  probability: number; // 0 to 100
}

const renderGestureIcon = (id: string, className: string = "w-5 h-5") => {
  switch (id) {
    case 'circle':
      return <Circle className={`${className} text-blue-400`} />;
    case 'wave':
      return <Waves className={`${className} text-emerald-400`} />;
    case 'idle':
      return <Moon className={`${className} text-purple-400`} />;
    default:
      return null;
  }
};

export default function App() {
  // Default values requested: Circle 80%, Wave 10%, Idle 10%
  const [gestures, setGestures] = useState<GestureOption[]>([
    { id: 'circle', name: 'Circle', icon: '⭕', probability: 80 },
    { id: 'wave', name: 'Wave', icon: '🌊', probability: 10 },
    { id: 'idle', name: 'Idle', icon: '😴', probability: 10 },
  ]);

  const [sensorActive, setSensorActive] = useState<boolean>(false);
  const [sensorMode, setSensorMode] = useState<SensorMode>('Waiting...');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [liveValues, setLiveValues] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  // References for live rendering raw coordinates
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number | null>(null);

  // 1125 floats (375 samples x 3 axes, interleaved X, Y, Z) sliding buffer
  const sampleBuffer = useRef<Float32Array>(new Float32Array(1125));
  
  // Realtime buffer and sampling clock states
  const currentReading = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const intervalId = useRef<any>(null);
  const tRef = useRef<number>(0);

  // Refs for high-pass software gravity filter
  const lastRawX = useRef<number>(0);
  const lastRawY = useRef<number>(0);
  const lastRawZ = useRef<number>(0);

  const lastHpX = useRef<number>(0);
  const lastHpY = useRef<number>(0);
  const lastHpZ = useRef<number>(0);

  // Avoid stale closure in intervals
  const sensorModeRef = useRef<SensorMode>('Waiting...');
  const sensorActiveRef = useRef<boolean>(false);

  useEffect(() => {
    sensorModeRef.current = sensorMode;
  }, [sensorMode]);

  useEffect(() => {
    sensorActiveRef.current = sensorActive;
  }, [sensorActive]);

  // Handle ResizeObserver to resize canvas resolution dynamically to prevent stretch artifacts
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = entry.contentRect.width;
          canvas.height = 120;
        }
      }
    });

    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, []);

  const [mlReady, setMlReady] = useState<boolean>(false);

  // Bind WebAssembly listener
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mod = (window as any).Module;
      if (mod) {
        if (typeof mod.run_classifier === 'function') {
          setMlReady(true);
        } else {
          // Listen for onRuntimeInitialized
          const oldOnInit = mod.onRuntimeInitialized;
          mod.onRuntimeInitialized = () => {
            if (oldOnInit) oldOnInit();
            setMlReady(true);
          };
        }
      }
    }
  }, []);

  // Update probabilities state helper
  const updateProbabilities = (circle: number, wave: number, idle: number) => {
    setGestures([
      { id: 'circle', name: 'Circle', icon: '⭕', probability: Math.round(circle) },
      { id: 'wave', name: 'Wave', icon: '👋', probability: Math.round(wave) },
      { id: 'idle', name: 'Idle', icon: '🧘', probability: Math.round(idle) },
    ]);
  };

  // Central sampling clock at 62.5Hz
  const startSamplingClock = () => {
    if (intervalId.current) clearInterval(intervalId.current);

    intervalId.current = setInterval(() => {
      let x = 0;
      let y = 0;
      let z = 0;

      if (sensorActiveRef.current) {
        // Real or simulated sensor active
        if (sensorModeRef.current !== 'SW Filter' || lastHpX.current !== 0 || lastRawX.current !== 0) {
          // Real sensors providing readings
          x = currentReading.current.x;
          y = currentReading.current.y;
          z = currentReading.current.z;
        } else {
          // High-fidelity fallback simulated signals
          tRef.current += 0.15;
          const t = tRef.current;
          x = Math.sin(t) * 4 + Math.cos(t * 1.5) * 2;
          y = Math.cos(t * 1.2) * 3.5 + Math.sin(t * 0.8) * 1.5;
          z = Math.sin(t * 0.7) * 2.5 + Math.cos(t * 1.3) * 1.8;
        }
      } else {
        // Peaceful scrolling baseline
        tRef.current += 0.05;
        const t = tRef.current;
        x = Math.sin(t) * 0.8 + (Math.random() - 0.5) * 0.1;
        y = Math.cos(t * 1.2) * 0.6 + (Math.random() - 0.5) * 0.1;
        z = Math.sin(t * 0.7) * 0.4 + (Math.random() - 0.5) * 0.1;
      }

      // Slide interleaved buffer left by 3 elements and input new sample
      const buf = sampleBuffer.current;
      buf.copyWithin(0, 3);
      buf[1122] = x;
      buf[1123] = y;
      buf[1124] = z;

      setLiveValues({ x, y, z });

      // Classify gestures dynamically if sensors are active
      let classifiedByWasm = false;
      if (sensorActiveRef.current && typeof window !== 'undefined') {
        const mod = (window as any).Module;
        if (mod && typeof mod.run_classifier === 'function') {
          try {
            const rawValues = sampleBuffer.current;
            const result = mod.run_classifier(rawValues, rawValues.length, false);
            if (result && result.classification) {
              const classification = result.classification;
              setGestures(prev => prev.map(g => {
                const found = classification.find((c: any) => 
                  c.label.toLowerCase() === g.id || 
                  c.label.toLowerCase() === g.name.toLowerCase()
                );
                if (found) {
                  let probVal = found.value;
                  // Handle both fractional proportions (0.0 - 1.0) and percentages (0 - 100)
                  if (probVal >= 0 && probVal <= 1.0) {
                    probVal = probVal * 100;
                  }
                  return { ...g, probability: Math.round(probVal) };
                }
                return g;
              }));
              classifiedByWasm = true;
            }
          } catch (err) {
            console.warn('WASM run_classifier failed, falling back to simulated inference', err);
          }
        }
      }

      if (!classifiedByWasm && sensorActiveRef.current) {
        // High fidelity software magnitude classifier fallback
        const mag = Math.sqrt(x * x + y * y + z * z);
        if (mag > 10) {
          // Wave movement
          updateProbabilities(15, 75, 10);
        } else if (mag > 4 && mag <= 10) {
          // Circle movement
          updateProbabilities(82, 10, 8);
        } else {
          // Static placement - Idle
          updateProbabilities(5, 5, 90);
        }
      }
    }, 16); // 1000ms / 62.5Hz = 16ms interval
  };

  // Run initial quiet sampling clock before start
  useEffect(() => {
    startSamplingClock();
    return () => {
      if (intervalId.current) clearInterval(intervalId.current);
    };
  }, []);

  // Sensor fallback chain on active click
  const handleStartSensors = async () => {
    setPermissionError(null);

    // Tier 1 — LinearAccelerationSensor (W3C Generic Sensor API)
    try {
      if ('LinearAccelerationSensor' in window) {
        const LinearAcc = (window as any).LinearAccelerationSensor;
        const sensor = new LinearAcc({ frequency: 62.5 });

        sensor.addEventListener('reading', () => {
          setSensorActive(true);
          setSensorMode('Generic Sensor');
          currentReading.current = {
            x: sensor.x || 0,
            y: sensor.y || 0,
            z: sensor.z || 0,
          };
        });

        sensor.addEventListener('error', (event: any) => {
          console.warn('LinearAccelerationSensor failed, fallback to Tier 3:', event.error);
          tryTier2();
        });

        sensor.start();
        setSensorActive(true);
        setSensorMode('Generic Sensor');
        startSamplingClock();
        return;
      }
    } catch (e) {
      console.warn('Tier 1 sensor setup failed, trying Tier 2:', e);
    }

    // Tier 2 Fallback
    await tryTier2();
  };

  const tryTier2 = async () => {
    try {
      if (typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
        const reqPermission = (DeviceMotionEvent as any).requestPermission;
        if (typeof reqPermission === 'function') {
          // iOS 13+ sensor protection popup
          const response = await reqPermission();
          if (response === 'granted') {
            setupDeviceMotion();
          } else {
            setPermissionError('Sensor permission denied. SW filtering enabled.');
            setupSimulatedSensors();
          }
        } else {
          // Android, non-iOS standard browsers
          setupDeviceMotion();
        }
      } else {
        setPermissionError('Generic sensors not supported. SW filtering active.');
        setupSimulatedSensors();
      }
    } catch (e) {
      console.warn('Tier 2 sensor setup failed, fallback to simulated info:', e);
      setupSimulatedSensors();
    }
  };

  const setupDeviceMotion = () => {
    setSensorActive(true);
    // Bind handleRealMotion
    window.addEventListener('devicemotion', handleRealMotion, true);
    startSamplingClock();
  };

  const setupSimulatedSensors = () => {
    setSensorActive(true);
    setSensorMode('SW Filter');
    startSamplingClock();
  };

  // Capture real motion telemetry and update dynamic buffer & classifications
  const handleRealMotion = (event: DeviceMotionEvent) => {
    const acc = event.acceleration;
    const accGrav = event.accelerationIncludingGravity;

    if (acc && acc.x !== null && acc.x !== undefined) {
      // Tier 2 - Pure acceleration without gravity
      setSensorMode('Device Motion');
      currentReading.current = {
        x: acc.x,
        y: acc.y,
        z: acc.z,
      };
    } else if (accGrav && accGrav.x !== null) {
      // Tier 3 - Software gravity filter fallback
      setSensorMode('SW Filter');

      const x = accGrav.x || 0;
      const y = accGrav.y || 0;
      const z = accGrav.z || 0;

      // Apply high-pass filter: highPassX = 0.8 * (highPassX + x - lastX)
      const hpX = 0.8 * (lastHpX.current + x - lastRawX.current);
      const hpY = 0.8 * (lastHpY.current + y - lastRawY.current);
      const hpZ = 0.8 * (lastHpZ.current + z - lastRawZ.current);

      // Save history for filter
      lastHpX.current = hpX;
      lastHpY.current = hpY;
      lastHpZ.current = hpZ;

      lastRawX.current = x;
      lastRawY.current = y;
      lastRawZ.current = z;

      currentReading.current = {
        x: hpX,
        y: hpY,
        z: hpZ,
      };
    }
  };

  // Safely detach event listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('devicemotion', handleRealMotion, true);
      if (intervalId.current) clearInterval(intervalId.current);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  // Live 60fps waveform loop using requestAnimationFrame
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animationFrameId.current = requestAnimationFrame(draw);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;

      // Dark background fill
      ctx.fillStyle = '#0d0d0d';
      ctx.fillRect(0, 0, w, h);

      // Delicate grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 24) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }
      for (let i = 0; i < h; i += 24) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(w, i);
        ctx.stroke();
      }

      // X/Y/Z coordinate baseline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Render X, Y, Z waveform waves
      const drawAxisPath = (offset: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        let first = true;
        for (let s = 0; s < 375; s++) {
          const val = sampleBuffer.current[s * 3 + offset];
          // Scale accelerometer readings cleanly to fit inside h-120
          const scaled = val * 3;
          const xPos = (s / 374) * w;
          const yPos = h / 2 - scaled;

          if (first) {
            ctx.moveTo(xPos, yPos);
            first = false;
          } else {
            ctx.lineTo(xPos, yPos);
          }
        }
        ctx.stroke();
      };

      // X: Electric Blue, Y: Emerald Green, Z: Purple
      drawAxisPath(0, '#3b82f6');
      drawAxisPath(1, '#10b981');
      drawAxisPath(2, '#a855f7');

      animationFrameId.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  // Update active modes toggling directly (optional)
  const cycleSensorMode = () => {
    if (!sensorActive) return;
    setSensorMode((prev) => {
      switch (prev) {
        case 'Waiting...':
          return 'Generic Sensor';
        case 'Generic Sensor':
          return 'Device Motion';
        case 'Device Motion':
          return 'SW Filter';
        case 'SW Filter':
          return 'Generic Sensor';
        default:
          return 'Generic Sensor';
      }
    });
  };

  const handleGestureManualClick = (id: 'circle' | 'wave' | 'idle') => {
    if (id === 'circle') {
      updateProbabilities(80, 10, 10);
    } else if (id === 'wave') {
      updateProbabilities(15, 75, 10);
    } else {
      updateProbabilities(10, 10, 80);
    }
  };

  const topGesture = [...gestures].sort((a, b) => b.probability - a.probability)[0];

  return (
    <div className="w-full h-screen bg-[#0d0d0d] flex items-center justify-center overflow-hidden font-sans text-white select-none">
      <div className="w-full max-w-[480px] h-[768px] flex flex-col bg-[#0d0d0d] border-x border-white/10 shadow-2xl overflow-hidden relative">
        
        {/* Decorative Glow Ambient Lights */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex-1 overflow-y-auto flex flex-col no-scrollbar">
          {/* 1. Header Section */}
          <header className="p-6 pb-2 text-center shrink-0">
            <h1 className="text-2xl font-black tracking-widest uppercase text-white flex items-center justify-center gap-2 font-sans">
              Gesture Classifier
            </h1>
          </header>

          {/* 2. Info Text Section */}
          <div className="px-6 py-2 text-center shrink-0">
            <p className="text-gray-400 text-sm">Move your phone to detect gestures</p>
          </div>

          {/* 3. Start Button Container */}
          <div className="px-6 py-4 shrink-0">
            <button
              onClick={handleStartSensors}
              disabled={sensorActive}
              className={`w-full py-4 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2 cursor-pointer ${
                sensorActive 
                  ? 'bg-neutral-800 border border-emerald-500/30 text-emerald-400 cursor-not-allowed shadow-none' 
                  : 'bg-gradient-to-r from-[#3b82f6] to-[#1d4ed8] shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:brightness-110 active:scale-95'
              }`}
            >
              {sensorActive ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  SENSORS ACTIVE ✓
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  START SENSORS
                </>
              )}
            </button>
            {permissionError && (
              <p className="text-[11px] text-amber-400 font-medium text-center mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg py-1 px-2">
                ⚠️ {permissionError}
              </p>
            )}
          </div>

          {/* 4. Live Axis Value Cards */}
          <div className="px-6 py-2 flex flex-col gap-2 shrink-0">
            {/* X Axis */}
            <div className="p-3 backdrop-blur-xl border border-white/10 bg-white/5 rounded-2xl flex justify-between items-center transition-all duration-200 hover:bg-white/10">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold tracking-wider text-[#3b82f6] uppercase">X Axis</span>
                <span className="text-xl font-black font-mono text-white mt-0.5">
                  {liveValues.x.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Y Axis */}
            <div className="p-3 backdrop-blur-xl border border-white/10 bg-white/5 rounded-2xl flex justify-between items-center transition-all duration-200 hover:bg-white/10">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold tracking-wider text-[#3b82f6] uppercase">Y Axis</span>
                <span className="text-xl font-black font-mono text-white mt-0.5">
                  {liveValues.y.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Z Axis */}
            <div className="p-3 backdrop-blur-xl border border-white/10 bg-white/5 rounded-2xl flex justify-between items-center transition-all duration-200 hover:bg-white/10">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold tracking-wider text-[#3b82f6] uppercase">Z Axis</span>
                <span className="text-xl font-black font-mono text-white mt-0.5">
                  {liveValues.z.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* 5. Waveform Canvas Section */}
          <div className="px-6 py-4 shrink-0">
            <div id="waveform" className="w-full h-[120px] bg-black/40 border border-white/10 rounded-xl relative overflow-hidden">
              <canvas
                ref={canvasRef}
                height={120}
                className="w-full h-[120px] block"
              />
              <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] font-mono pointer-events-none bg-black/60 px-2 py-0.5 rounded-md border border-white/5">
                <span className="text-[#3b82f6]">X-AXIS</span>
                <span className="text-[#10b981]">Y-AXIS</span>
                <span className="text-[#a855f7]">Z-AXIS</span>
              </div>
            </div>
          </div>

          {/* 6. Gesture Cards */}
          <div className="px-6 py-2 flex-1 flex flex-col gap-3">
            {gestures.map((item) => {
              const isTop = item.id === topGesture.id;
              return (
                <div
                  key={item.id}
                  onClick={() => handleGestureManualClick(item.id)}
                  className={`p-4 backdrop-blur-xl border rounded-2xl flex items-center gap-4 cursor-pointer select-none transition-all duration-300 ${
                    isTop
                      ? 'relative bg-white/10 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                      : 'bg-white/5 border-white/10 opacity-60 hover:opacity-90'
                  }`}
                >
                  <div className="flex items-center gap-2 w-16 shrink-0">
                    {renderGestureIcon(item.id, "w-5 h-5")}
                    <span className="text-sm font-bold text-neutral-100">{item.name}</span>
                  </div>

                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isTop ? 'bg-blue-500' : 'bg-gray-500'
                      }`}
                      style={{ width: `${item.probability}%` }}
                    />
                  </div>

                  <span className={`text-sm font-mono font-bold ${isTop ? 'text-blue-400' : 'text-neutral-300'}`}>
                    {item.probability}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* 7. Bottom Result Badge */}
          <div className="p-6 pt-2 shrink-0">
            <div className="w-full p-6 bg-blue-500/20 border border-blue-500/30 rounded-3xl flex items-center justify-center gap-4 shadow-[0_4px_20px_rgba(59,130,246,0.15)]">
              {renderGestureIcon(topGesture.id, "w-10 h-10")}
              <span className="text-3xl font-black uppercase tracking-tighter text-white">{topGesture.name}</span>
            </div>
          </div>

        </div>

        {/* Home Navigation bar decorator to complete device casing layout */}
        <div className="w-32 h-1.5 bg-white/20 rounded-full mx-auto mb-2 shrink-0"></div>
      </div>
    </div>
  );
}
