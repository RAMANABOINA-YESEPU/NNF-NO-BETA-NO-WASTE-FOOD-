import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  RotateCcw,
  Upload,
  Smartphone,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Zap,
  ZapOff,
} from 'lucide-react';
import { compressImage } from '../utils/imageUtils';

export interface CameraCaptureProps {
  /**
   * Callback fired when a photo is captured from camera or uploaded from file.
   * Receives the compressed JPEG base64 string.
   */
  onCapture: (base64Photo: string) => void;
  /** Max dimension for compression (640 for mess food plate, 300 for student reference photo) */
  targetMaxDimension?: number;
  /** Compression quality (default 0.6) */
  quality?: number;
  /** Guide overlay type: 'student-face', 'plate-and-face', or 'none' */
  overlayType?: 'student-face' | 'plate-and-face' | 'none';
  /** Aspect ratio CSS class (default 'aspect-[4/3] sm:aspect-video') */
  aspectRatioClass?: string;
  /** Minimum container height (default 'min-h-[260px]') */
  minHeightClass?: string;
  /** Custom shutter button title */
  shutterTitle?: string;
  /** Whether to show flip camera button */
  showFlipButton?: boolean;
}

export interface CameraErrorInfo {
  name: string;
  message: string;
  hint: string;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  targetMaxDimension = 640,
  quality = 0.6,
  overlayType = 'plate-and-face',
  aspectRatioClass = 'aspect-[4/3] sm:aspect-video',
  minHeightClass = 'min-h-[260px]',
  shutterTitle = 'Take photo',
  showFlipButton = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const standardFileInputRef = useRef<HTMLInputElement>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement>(null);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<CameraErrorInfo | null>(null);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [hasTorchSupport, setHasTorchSupport] = useState<boolean>(false);
  const [screenFlash, setScreenFlash] = useState<boolean>(false);

  // Play shutter sound on capture
  const playShutterSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // AudioContext unavailable
    }
  };

  // Helper: map error name and message to a plain-language actionable hint
  const getPlainLanguageHint = (errName: string, errMessage: string): string => {
    switch (errName) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'Allow camera permission: Click the lock or camera icon in your browser address bar, set Camera to "Allow", and click "Try again".';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No camera hardware found on this device. Please use "Upload photo" or "Take photo with phone camera" below.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Close other apps using the camera (Zoom, Teams, Google Meet, or another browser tab) and tap "Try again".';
      case 'SecurityError':
        return 'Camera access is restricted by security policy or iframe permissions. Please use the "Upload photo" or "Take photo with phone camera" buttons below.';
      default:
        return errMessage || 'Camera could not be opened. You can click "Try again" or upload a photo below.';
    }
  };

  // Stop all active stream tracks completely
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Track stop error:', e);
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  // Start Camera with user facingMode and robust 3-stage fallback sequence
  const startCamera = async (targetFacing = facingMode) => {
    // 1. Stop all tracks before starting again
    stopCamera();
    setIsLoadingCamera(true);
    setCameraError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsLoadingCamera(false);
      setCameraError({
        name: 'NotSupportedError',
        message: 'Camera API is not supported in this browser environment.',
        hint: 'Please use the "Upload photo" or mobile camera buttons below.',
      });
      return;
    }

    let stream: MediaStream | null = null;
    let lastError: any = null;

    // Stage 1: getUserMedia with ideal facingMode
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: targetFacing } },
        audio: false,
      });
    } catch (err1: any) {
      lastError = err1;
      // Stage 2: retry with { video: true, audio: false }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        lastError = null;
      } catch (err2: any) {
        lastError = err2;
        // Stage 3: try every device from enumerateDevices()
        try {
          const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
          const videoDevices = devices.filter((d) => d.kind === 'videoinput');
          for (const dev of videoDevices) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: dev.deviceId } },
                audio: false,
              });
              if (stream) {
                lastError = null;
                break;
              }
            } catch (devErr) {
              lastError = devErr;
            }
          }
        } catch (enumErr) {
          lastError = enumErr;
        }
      }
    }

    if (!stream) {
      stopCamera();
      setIsLoadingCamera(false);
      const name = lastError?.name || 'CameraError';
      const message = lastError?.message || 'Unable to open camera stream.';
      const hint = getPlainLanguageHint(name, message);
      setCameraError({ name, message, hint });
      return;
    }

    // Stream acquired: attach to mounted <video> element with muted, playsInline and autoPlay, then await video.play()
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.setAttribute('autoplay', 'true');

      video.onloadedmetadata = () => {
        video.play().catch((e) => console.warn('video.play onloadedmetadata:', e));
      };

      try {
        await video.play();
        setIsStreaming(true);
        setCameraError(null);

        // Check if device camera supports hardware torch/flashlight
        try {
          const track = stream.getVideoTracks()[0];
          const capabilities: any = track.getCapabilities?.() || {};
          setHasTorchSupport(Boolean(capabilities.torch));
        } catch {
          setHasTorchSupport(false);
        }
      } catch (playErr: any) {
        console.warn('Video play error:', playErr);
        setIsStreaming(true);
      }
    } else {
      setIsStreaming(true);
    }
    setIsLoadingCamera(false);
  };

  // Mount the <video> element first, then call getUserMedia
  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isMounted) {
        startCamera(facingMode);
      }
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      stopCamera();
    };
  }, [facingMode]);

  // Stop all tracks when Flip is pressed, then switch facing mode
  const handleFlip = () => {
    stopCamera();
    setIsTorchOn(false);
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
  };

  // Toggle flashlight / torch on back camera if supported
  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    try {
      const track = streamRef.current.getVideoTracks()[0];
      const nextState = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch (e) {
      console.warn('Torch toggle constraint failed:', e);
      setIsTorchOn((prev) => !prev);
    }
  };

  // Capture frame from active video stream
  const handleCapture = async () => {
    if (!videoRef.current) return;
    playShutterSound();
    setScreenFlash(true);
    setTimeout(() => setScreenFlash(false), 220);

    try {
      const video = videoRef.current;
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context could not be created.');
      }

      ctx.drawImage(video, 0, 0, width, height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      // Stop stream once frame is captured to release device camera
      stopCamera();

      // Compress to requested dimension and quality (e.g. 640px, 0.6)
      const compressed = await compressImage(rawDataUrl, targetMaxDimension, quality);
      onCapture(compressed);
    } catch (err: any) {
      console.error('Frame capture failed:', err);
    }
  };

  // Handle file chosen from disk or phone camera fallback
  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      stopCamera();
      const compressed = await compressImage(file, targetMaxDimension, quality);
      onCapture(compressed);
    } catch (err: any) {
      console.error('File compression failed:', err);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-3xl overflow-hidden border border-slate-700/60 shadow-xl flex flex-col">
      {/* Hidden File Inputs for Fallbacks */}
      <input
        ref={standardFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFilePicked}
        className="hidden"
      />
      <input
        ref={mobileCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilePicked}
        className="hidden"
      />

      {/* Viewport Box (Video element ALWAYS MOUNTED) */}
      <div
        className={`relative w-full ${aspectRatioClass} ${minHeightClass} bg-black flex items-center justify-center overflow-hidden`}
        style={{ minHeight: '240px' }}
      >
        {/* The <video> element is ALWAYS MOUNTED and visible with width 100%, min-height 240px */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover min-h-[240px] block ${
            facingMode === 'user' ? 'scale-x-[-1]' : ''
          }`}
          style={{ width: '100%', minHeight: '240px' }}
        />

        {/* Loading Spinner State while starting camera */}
        {isLoadingCamera && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 z-10 space-y-2 p-4 pointer-events-none">
            <div className="w-8 h-8 border-3 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
            <p className="text-xs text-slate-300 font-medium">Starting camera...</p>
          </div>
        )}

        {/* Camera Error / Blocked Overlay with Exact Error & Plain-Language Hint */}
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 z-20 p-5 text-center overflow-y-auto">
            <div className="max-w-md w-full space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto shadow-md">
                <AlertTriangle className="w-6 h-6" />
              </div>

              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold uppercase tracking-wider mb-1.5 font-mono">
                  {cameraError.name}
                </div>
                <h4 className="text-sm font-bold text-slate-100">Camera Viewfinder Inactive</h4>

                {cameraError.message && (
                  <p className="text-[11px] text-slate-400 font-mono bg-slate-900/90 p-2 rounded-xl border border-slate-800 break-words mt-1.5 text-left">
                    {cameraError.message}
                  </p>
                )}
              </div>

              {cameraError.hint && (
                <div className="p-3 rounded-xl bg-teal-950/80 border border-teal-500/40 text-left flex items-start gap-2 shadow-sm">
                  <Sparkles className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-teal-200 font-medium leading-relaxed">
                    <strong>Hint:</strong> {cameraError.hint}
                  </p>
                </div>
              )}

              {/* Try Again and Fallback Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-100 border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Try again</span>
                </button>

                <button
                  type="button"
                  onClick={() => standardFileInputRef.current?.click()}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => mobileCameraInputRef.current?.click()}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-teal-300 border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-all"
                >
                  <Smartphone className="w-3.5 h-3.5 text-teal-400" />
                  <span>Phone camera</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Visual Smart Framing Overlay (pointer-events-none, never blocking video) */}
        {isStreaming && !cameraError && overlayType !== 'none' && (
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 z-10">
            {overlayType === 'student-face' && (
              <div className="self-center my-auto border-2 border-dashed border-teal-400/80 rounded-full w-36 h-36 flex items-center justify-center bg-teal-500/10">
                <span className="text-[10px] font-bold text-teal-300 uppercase tracking-wider bg-slate-900/80 px-2 py-0.5 rounded-full">
                  Student Face
                </span>
              </div>
            )}

            {overlayType === 'plate-and-face' && (
              <>
                {/* Face Guide */}
                <div className="self-center border-2 border-dashed border-emerald-400/70 rounded-full w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center bg-emerald-500/10 backdrop-blur-[1px]">
                  <span className="text-[9px] sm:text-[10px] font-bold text-emerald-300 uppercase tracking-wider bg-slate-900/80 px-2 py-0.5 rounded-full">
                    Student Face
                  </span>
                </div>

                {/* Plate Guide */}
                <div className="self-center border-2 border-dashed border-teal-400/70 rounded-2xl w-44 h-20 sm:w-52 sm:h-24 flex items-center justify-center bg-teal-500/10 backdrop-blur-[1px]">
                  <span className="text-[9px] sm:text-[10px] font-bold text-teal-300 uppercase tracking-wider bg-slate-900/80 px-2 py-0.5 rounded-full">
                    Food Plate / Tray
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Screen Flash Visual Feedback on capture */}
        {screenFlash && (
          <div className="absolute inset-0 bg-white/90 z-30 pointer-events-none animate-out fade-out duration-200" />
        )}

        {/* Flash / Torch Button (top-left) */}
        {isStreaming && !cameraError && (
          <button
            type="button"
            onClick={handleToggleTorch}
            className={`absolute top-3 left-3 z-20 px-3 py-1.5 rounded-xl backdrop-blur-md border shadow-lg flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-transform active:scale-95 ${
              isTorchOn
                ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-300'
                : 'bg-slate-900/80 hover:bg-slate-900 text-slate-200 border-slate-700/60'
            }`}
            title={isTorchOn ? 'Turn Flashlight Off' : 'Turn Flashlight On'}
          >
            {isTorchOn ? (
              <Zap className="w-3.5 h-3.5 fill-current text-slate-950" />
            ) : (
              <ZapOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>{isTorchOn ? 'Flash On' : 'Flash'}</span>
          </button>
        )}

        {/* Flip Camera Button (top-right) */}
        {showFlipButton && isStreaming && !cameraError && (
          <button
            type="button"
            onClick={handleFlip}
            className="absolute top-3 right-3 z-20 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-slate-200 backdrop-blur-md border border-slate-700/60 shadow-lg flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-transform active:scale-95"
            title={`Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
          >
            <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            <span>{facingMode === 'user' ? 'Flip to Back' : 'Flip to Front'}</span>
          </button>
        )}
      </div>

      {/* Action Bar Under Camera (Upload photo & Phone camera always clearly accessible) */}
      <div className="p-3.5 sm:p-4 bg-slate-950/95 border-t border-slate-800 space-y-2.5">
        <div className="flex items-center justify-around gap-2 sm:gap-4">
          {/* Visible Fallback Button 1: Upload Photo */}
          <button
            type="button"
            onClick={() => standardFileInputRef.current?.click()}
            className="px-3 sm:px-3.5 py-2.5 sm:py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700/60 text-xs font-semibold flex items-center gap-1.5 sm:gap-2 cursor-pointer transition-all shadow-md shrink-0"
            title="Upload photo from files"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Upload photo</span>
          </button>

          {/* Shutter Capture Button */}
          <button
            type="button"
            onClick={handleCapture}
            disabled={!isStreaming || Boolean(cameraError)}
            className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full p-1.5 shadow-2xl transition-all active:scale-95 flex items-center justify-center cursor-pointer shrink-0 ${
              isStreaming && !cameraError
                ? 'bg-gradient-to-tr from-emerald-500 via-teal-400 to-emerald-300 shadow-emerald-500/40'
                : 'bg-slate-800 opacity-40 cursor-not-allowed'
            }`}
            title={shutterTitle}
          >
            <div className="w-full h-full rounded-full border-4 border-white/90 bg-emerald-600 flex items-center justify-center shadow-inner">
              <Camera className="w-6 h-6 text-white drop-shadow" />
            </div>
          </button>

          {/* Visible Fallback Button 2: Take photo with native phone camera */}
          <button
            type="button"
            onClick={() => mobileCameraInputRef.current?.click()}
            className="px-3 sm:px-3.5 py-2.5 sm:py-3 rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700/60 text-xs font-semibold flex items-center gap-1.5 sm:gap-2 cursor-pointer transition-all shadow-md shrink-0"
            title="Take photo with phone camera app"
          >
            <Smartphone className="w-4 h-4 text-teal-400" />
            <span className="hidden sm:inline">Take photo with phone camera</span>
            <span className="sm:hidden">Phone camera</span>
          </button>
        </div>
      </div>
    </div>
  );
};
