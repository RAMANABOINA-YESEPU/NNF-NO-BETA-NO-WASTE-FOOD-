import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  RotateCcw,
  Sparkles,
  Upload,
  Check,
  Search,
  User,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  Flame,
  X,
  Smartphone,
  ExternalLink,
  QrCode,
  AlertTriangle,
} from 'lucide-react';
import jsQR from 'jsqr';
import { motion, AnimatePresence } from 'motion/react';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Student, MealSession, WasteLevel, WasteRecord, FaceMatchCandidate } from '../types';
import { compressImage } from '../utils/imageUtils';
import { extractGrFromQrPayload } from '../utils/qrUtils';
import { detectLargestFaceDescriptor, matchFaceAgainstStudents } from '../utils/faceRecognition';
import { WASTE_LEVEL_META } from '../utils/wasteTokens';
import { CameraCapture } from './CameraCapture';

interface ScanTabProps {
  students: Student[];
  onRecordSaved: (record: WasteRecord) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'error') => void;
  currentSession: MealSession;
  onSessionChange: (session: MealSession) => void;
  scannedTodayCount?: number;
}

export const ScanTab: React.FC<ScanTabProps> = ({
  students,
  onRecordSaved,
  showToast,
  currentSession,
  onSessionChange,
  scannedTodayCount = 0,
}) => {
  // Hostel filter
  const [hostelFilter, setHostelFilter] = useState<string>('All');

  // Background Sync and timeout states
  const [syncingCount, setSyncingCount] = useState<number>(0);
  const [syncingStudentName, setSyncingStudentName] = useState<string>('');
  const [failedRecords, setFailedRecords] = useState<
    Array<{ id: string; record: WasteRecord; error: string }>
  >([]);

  // Capture workflow state
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Requirement 3, 5, 8: Local face recognition state via face-api.js
  const [isDetectingFace, setIsDetectingFace] = useState<boolean>(false);
  const [faceModelStatus, setFaceModelStatus] = useState<string>('');
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null);
  const [faceMatches, setFaceMatches] = useState<FaceMatchCandidate[]>([]);
  const [multipleFacesFound, setMultipleFacesFound] = useState<boolean>(false);
  const [isStudentConfirmed, setIsStudentConfirmed] = useState<boolean>(false);
  const [isQrVerified, setIsQrVerified] = useState<boolean>(false);

  // Requirement 6: Gemini plate waste assessment state (plate ONLY)
  const [isAnalyzingPlate, setIsAnalyzingPlate] = useState<boolean>(false);
  const [plateAnalysisError, setPlateAnalysisError] = useState<string | null>(null);

  // Selected student and waste level
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedWasteLevel, setSelectedWasteLevel] = useState<WasteLevel>('Medium');
  const [reasonNote, setReasonNote] = useState<string>('');

  // Manual search modal
  const [showSearchModal, setShowSearchModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // QR Code Scanner Modal & State
  const [isQrScanning, setIsQrScanning] = useState<boolean>(false);
  const [qrCameraFacing, setQrCameraFacing] = useState<'environment' | 'user'>('environment');
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const qrAnimationRef = useRef<number | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

  // Photo captured or chosen via shared CameraCapture component (compressed to max 640px, quality 0.6)
  const handlePhotoCaptured = (compressedPhoto: string) => {
    setCapturedPhoto(compressedPhoto);
    showToast('Plate photo captured & optimized (max 640px).', 'success');

    // Run local face-api.js recognition pipeline
    runLocalFaceRecognition(compressedPhoto);

    // Run Gemini AI solely for plate food waste estimation
    runGeminiPlateAnalysis(compressedPhoto);
  };

  /**
   * Requirement 3, 4, 5: Local face recognition pipeline
   * - Detects face in captured image with face-api.js
   * - Computes 128-number face descriptor
   * - Compares with all students' saved descriptors using Euclidean distance
   * - Sorts by distance and gets top 3 matches
   * - Requires staff confirmation (never auto-saves on weak match)
   */
  const runLocalFaceRecognition = async (photoBase64: string) => {
    setIsDetectingFace(true);
    setFaceMatches([]);
    setFaceDetected(null);
    setMultipleFacesFound(false);

    // If student was already QR verified before capturing, keep them confirmed!
    if (!isQrVerified) {
      setIsStudentConfirmed(false);
    }

    try {
      setFaceModelStatus('Loading face recognition models...');
      const result = await detectLargestFaceDescriptor(photoBase64, (status) => {
        setFaceModelStatus(status);
      });

      if (!result || !result.descriptor || result.descriptor.length !== 128) {
        setFaceDetected(false);
        setFaceMatches([]);
        if (!isQrVerified) {
          setSelectedStudent(null);
        }
        return;
      }

      setFaceDetected(true);
      if (result.allFacesCount > 1) {
        setMultipleFacesFound(true);
      }

      // Filter candidates by hostel filter if active
      let pool = students;
      if (hostelFilter !== 'All') {
        pool = students.filter((s) => s.hostel === hostelFilter);
      }

      // Requirement 3: Compare with all students' descriptors using Euclidean distance
      const candidates = matchFaceAgainstStudents(result.descriptor, pool);
      setFaceMatches(candidates);

      // Requirement 4: Always ask staff to confirm the selected student before saving
      if (!isQrVerified) {
        if (candidates.length > 0 && candidates[0].matchType === 'strong') {
          // Pre-select strong match for staff review, but do NOT mark confirmed until staff verifies
          setSelectedStudent(candidates[0].student);
          setIsStudentConfirmed(false);
        } else {
          // Weak match or no match: do not auto-select
          setSelectedStudent(null);
          setIsStudentConfirmed(false);
        }
      }
    } catch (err: any) {
      console.error('Face recognition error:', err);
      setFaceDetected(false);
    } finally {
      setIsDetectingFace(false);
      setFaceModelStatus('');
    }
  };

  /**
   * Requirement 6: Use Gemini ONLY to estimate the food waste level from the plate.
   */
  const runGeminiPlateAnalysis = async (photoBase64: string) => {
    setIsAnalyzingPlate(true);
    setPlateAnalysisError(null);

    try {
      const response = await fetch('/api/analyze-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capturedPhoto: photoBase64,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server HTTP ${response.status}`);
      }

      const data = await response.json();
      setSelectedWasteLevel(data.waste_level || 'Medium');
      setReasonNote(data.reason || '');
    } catch (err: any) {
      console.warn('Gemini plate analysis error:', err);
      setPlateAnalysisError(err?.message || 'Plate analysis service unavailable');
      setSelectedWasteLevel('Medium');
      if (!reasonNote) {
        setReasonNote('Plate photo captured at counter.');
      }
    } finally {
      setIsAnalyzingPlate(false);
    }
  };

  // QR SCANNER FUNCTIONS
  const stopQrScanner = () => {
    if (qrAnimationRef.current) {
      cancelAnimationFrame(qrAnimationRef.current);
      qrAnimationRef.current = null;
    }
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('QR track stop error:', e);
        }
      });
      qrStreamRef.current = null;
    }
    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = null;
    }
    setIsQrScanning(false);
    setQrScanError(null);
  };

  const handleStudentFoundFromQr = (grExtracted: string) => {
    // Stop QR scanner first
    stopQrScanner();

    // Look up student in registered directory
    const matched = students.find(
      (s) => s.gr.toUpperCase() === grExtracted.toUpperCase()
    );

    if (matched) {
      setSelectedStudent(matched);
      showToast(
        `QR verified: ${matched.name} (GR: ${matched.gr}, Hostel ${matched.hostel})! Now take food plate photo.`,
        'success'
      );
    } else {
      showToast(
        `No student found matching QR code ID: "${grExtracted}". Please register them in Students tab or search manually.`,
        'error'
      );
    }
  };

  const scanQrFrame = () => {
    if (!qrVideoRef.current) return;
    const video = qrVideoRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width > 0 && height > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (code && code.data) {
            const raw = code.data;
            const gr = extractGrFromQrPayload(raw);
            if (gr) {
              handleStudentFoundFromQr(gr);
              return; // Stop animation loop
            } else {
              setQrScanError(`Unrecognized QR code: ${raw}`);
            }
          }
        }
      }
    }

    qrAnimationRef.current = requestAnimationFrame(scanQrFrame);
  };

  const startQrScanner = async (facing: 'environment' | 'user' = qrCameraFacing) => {
    // Open QR scanner modal
    stopQrScanner();
    setQrScanError(null);
    setIsQrScanning(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setQrScanError('Camera not supported for QR scanning in this browser.');
      return;
    }

    let stream: MediaStream | null = null;
    let lastError: any = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err1: any) {
      lastError = err1;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        lastError = null;
      } catch (err2: any) {
        lastError = err2;
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
      const errName = lastError?.name || 'CameraError';
      const errMsg = lastError?.message || 'Camera blocked';
      setQrScanError(`${errName}: ${errMsg}. You can upload a photo of the QR code instead.`);
      return;
    }

    qrStreamRef.current = stream;
    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = stream;
      qrVideoRef.current.muted = true;
      qrVideoRef.current.playsInline = true;
      qrVideoRef.current.setAttribute('playsinline', 'true');
      qrVideoRef.current.setAttribute('muted', 'true');
      try {
        await qrVideoRef.current.play();
      } catch (e) {
        console.warn('QR video play error:', e);
      }
    }

    // Start continuous decode loop
    qrAnimationRef.current = requestAnimationFrame(scanQrFrame);
  };

  const toggleQrCameraFacing = () => {
    const next = qrCameraFacing === 'environment' ? 'user' : 'environment';
    setQrCameraFacing(next);
    startQrScanner(next);
  };

  // Fallback: upload an image file containing a QR code
  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            showToast('Failed to create canvas for QR decoding.', 'error');
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            const gr = extractGrFromQrPayload(code.data);
            if (gr) {
              handleStudentFoundFromQr(gr);
            } else {
              setQrScanError(`Unrecognized QR code content: "${code.data}"`);
            }
          } else {
            setQrScanError('No QR code found in the selected image. Please try another photo.');
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setQrScanError(`Failed to read QR image: ${err?.message || err}`);
    } finally {
      e.target.value = '';
    }
  };

  // Reset to scan next student
  const handleResetForNext = () => {
    setCapturedPhoto(null);
    setSelectedStudent(null);
    setIsStudentConfirmed(false);
    setIsQrVerified(false);
    setFaceMatches([]);
    setFaceDetected(null);
    setMultipleFacesFound(false);
    setFaceModelStatus('');
    setIsDetectingFace(false);
    setPlateAnalysisError(null);
    setIsAnalyzingPlate(false);
    setSelectedWasteLevel('Medium');
    setReasonNote('');
  };

  // Background Firestore write with 15-second timeout and retry queue
  const performBackgroundWrite = async (rec: WasteRecord) => {
    setSyncingCount((c) => c + 1);
    setSyncingStudentName(rec.studentName);

    try {
      const firestoreWrite = db
        ? setDoc(doc(db, 'waste_records', rec.id), rec)
        : Promise.resolve();

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error('Save timed out after 15 seconds. Check network connection.')
          );
        }, 15000);
      });

      await Promise.race([firestoreWrite, timeoutPromise]);

      // Write succeeded: remove from failed queue if it was retrying
      setFailedRecords((prev) => prev.filter((item) => item.id !== rec.id));
    } catch (err: any) {
      console.error('Background save to Firestore failed:', err);
      const errText = err?.name
        ? `${err.name}: ${err.message || 'Write failed'}`
        : err?.message || 'Sync timed out';
      setFailedRecords((prev) => [
        ...prev.filter((item) => item.id !== rec.id),
        { id: rec.id, record: rec, error: errText },
      ]);
      showToast(`Sync failed for ${rec.studentName}: ${errText}`, 'error');
    } finally {
      setSyncingCount((c) => Math.max(0, c - 1));
    }
  };

  // Retry failed record write
  const handleRetrySave = (rec: WasteRecord) => {
    showToast(`Retrying save for ${rec.studentName}...`, 'info');
    performBackgroundWrite(rec);
  };

  // Fast Save: close capture screen immediately, update state, write in background
  const handleSaveRecord = () => {
    if (!capturedPhoto) {
      showToast('Please capture or upload a photo first.', 'error');
      return;
    }
    if (!selectedStudent) {
      showToast('Please select or search for the student.', 'error');
      return;
    }

    // Requirement 4: Always ask staff to confirm the selected student before saving. Never save automatically on a weak match.
    if (!isStudentConfirmed && !isQrVerified) {
      showToast('Staff confirmation required: Please confirm student identity before saving.', 'error');
      return;
    }

    const recordId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestampIso = new Date().toISOString();

    // Store resized photo directly as base64 string (max 640px, quality 0.6) - NO Storage upload
    const newRecord: WasteRecord = {
      id: recordId,
      studentGr: selectedStudent.gr,
      studentName: selectedStudent.name,
      hostel: selectedStudent.hostel,
      session: currentSession, // Exact session selected by staff
      wasteLevel: selectedWasteLevel,
      reason: reasonNote.trim() || 'Food wastage recorded at mess counter.',
      photoUrl: capturedPhoto,
      isVerified: false,
      timestamp: timestampIso,
    };

    // 1. Instantly update in-memory UI list
    onRecordSaved(newRecord);
    setShowSaveSuccess(true);
    showToast(`Record saved for ${selectedStudent.name}!`, 'success');

    // 2. Play quick success animation (450ms) then return to camera for next student
    setTimeout(() => {
      setShowSaveSuccess(false);
      handleResetForNext();
    }, 450);

    // 3. Finish Firestore write in background with 15s timeout
    performBackgroundWrite(newRecord);
  };

  const filteredSearchStudents = students.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.gr.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4 pb-2">
      {/* Failed Records Retry Banner */}
      {failedRecords.length > 0 && (
        <div className="space-y-2">
          {failedRecords.map((item) => (
            <div
              key={item.id}
              className="bg-rose-950/90 border border-rose-500/70 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-lg"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="text-xs text-rose-200 min-w-0">
                  <p className="font-bold truncate">
                    Save failed for {item.record.studentName} ({item.record.studentGr})
                  </p>
                  <p className="text-[11px] text-rose-300/80 font-mono truncate">
                    {item.error}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRetrySave(item.record)}
                className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs shrink-0 cursor-pointer shadow-md transition-all"
              >
                Retry save
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Small Syncing... background indicator */}
      {syncingCount > 0 && (
        <div className="bg-teal-950/80 border border-teal-500/50 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-teal-300 shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
            <span className="font-semibold">
              Syncing record for {syncingStudentName || 'student'} to Firebase in background...
            </span>
          </div>
          <span className="text-[10px] text-teal-400/80 font-mono">15s timeout protection</span>
        </div>
      )}

      {/* Requirement 6: Slim top bar with session chips, counter name, live Scanned today, and online/offline/syncing indicator */}
      <div className="bg-slate-900/90 backdrop-blur-xl rounded-2xl p-2.5 sm:p-3 border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Counter Name Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-bold text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Counter #1 · Mess Hall</span>
          </div>

          {/* Session Chips */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-xl border border-slate-800">
            {(['Breakfast', 'Lunch', 'Dinner'] as MealSession[]).map((sess) => (
              <button
                key={sess}
                onClick={() => onSessionChange(sess)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentSession === sess
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sess}
              </button>
            ))}
          </div>
        </div>

        {/* Live Scanned Today + Sync Status + Scan QR + Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live Scanned Today badge */}
          <div className="px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-emerald-400">Today:</span>
            <span>{scannedTodayCount} scanned</span>
          </div>

          {/* Online / Offline / Syncing indicator */}
          <div
            className={`px-2 py-1 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 ${
              syncingCount > 0
                ? 'bg-teal-950/70 border-teal-500/40 text-teal-300'
                : !isOnline
                ? 'bg-amber-950/70 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            {syncingCount > 0 ? (
              <>
                <RefreshCw className="w-3 h-3 text-teal-400 animate-spin" />
                <span>Syncing</span>
              </>
            ) : !isOnline ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>Offline</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Online</span>
              </>
            )}
          </div>

          {/* Scan QR Button */}
          <button
            type="button"
            onClick={() => startQrScanner()}
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 active:scale-95 text-xs font-bold text-slate-950 flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
            title="Scan student QR pass"
          >
            <QrCode className="w-3.5 h-3.5 text-slate-950" />
            <span>Scan QR</span>
          </button>

          <div className="flex items-center gap-1 text-xs">
            <select
              value={hostelFilter}
              onChange={(e) => setHostelFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="All">All Hostels</option>
              <option value="A">Hostel A</option>
              <option value="B">Hostel B</option>
              <option value="C">Hostel C</option>
              <option value="D">Hostel D</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* If a student was identified via QR before taking photo, display clear banner */}
      {!capturedPhoto && selectedStudent && (
        <div className="bg-teal-950/80 border border-teal-500/50 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            {selectedStudent.photoUrl ? (
              <img
                src={selectedStudent.photoUrl}
                alt={selectedStudent.name}
                className="w-10 h-10 rounded-xl object-cover border border-teal-400 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-teal-900 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-teal-300" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-teal-500 text-slate-950">
                  QR Verified Student
                </span>
                <span className="text-xs font-bold text-teal-200">
                  Hostel {selectedStudent.hostel}
                </span>
              </div>
              <p className="text-sm font-bold text-white">
                {selectedStudent.name}{' '}
                <span className="text-xs font-mono font-normal text-teal-300">
                  ({selectedStudent.gr})
                </span>
              </p>
              <p className="text-[11px] text-teal-300/80">
                Ready! Now snap the student's plate below to save record.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedStudent(null)}
            className="p-1.5 rounded-lg bg-teal-900/60 hover:bg-teal-900 text-teal-300 hover:text-white text-xs cursor-pointer"
            title="Clear selected student"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main View: Shared Reusable CameraCapture Component OR Result Card */}
      {!capturedPhoto ? (
        <CameraCapture
          onCapture={handlePhotoCaptured}
          targetMaxDimension={640}
          quality={0.6}
          overlayType="plate-and-face"
          aspectRatioClass="aspect-[4/3] sm:aspect-video"
          minHeightClass="min-h-[260px]"
          shutterTitle="Capture Student and Food Plate"
          showFlipButton={true}
        />
      ) : (
        /* RESULT CARD (Photo Captured + AI Matches + Waste Buttons) */
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/90 rounded-3xl p-4 sm:p-5 border border-slate-700/80 shadow-2xl space-y-4"
        >
          {/* Header Row: Captured preview & Retake */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <img
                src={capturedPhoto}
                alt="Captured Face and Plate Preview"
                className="w-16 h-16 rounded-xl object-cover border-2 border-emerald-500/50 shadow-md"
              />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    {currentSession} Session
                  </span>
                  {isDetectingFace && (
                    <span className="flex items-center gap-1 text-[11px] text-teal-300 bg-teal-950/60 px-2 py-0.5 rounded-full border border-teal-800/50 animate-pulse">
                      <RefreshCw className="w-3 h-3 text-teal-400 animate-spin" />
                      Face Recognition...
                    </span>
                  )}
                  {isAnalyzingPlate && (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/50 animate-pulse">
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      Gemini Waste Analysis...
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-100 mt-0.5">
                  {selectedStudent ? selectedStudent.name : 'Select or confirm student below'}
                </p>
                {selectedStudent && (
                  <p className="text-xs text-slate-400">
                    GR: <span className="font-mono text-slate-300">{selectedStudent.gr}</span> • Hostel {selectedStudent.hostel}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleResetForNext}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer flex items-center gap-1 text-xs shrink-0"
              title="Retake photo"
            >
              <RotateCcw className="w-4 h-4 text-emerald-400" />
              <span>Retake</span>
            </button>
          </div>

          {/* Plate Waste Analysis Notice if occurred */}
          {plateAnalysisError && (
            <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <p className="font-semibold">Plate Analysis note: {plateAnalysisError}</p>
                <p className="text-[11px] text-amber-400/80">Please adjust waste level manually using the buttons below.</p>
              </div>
            </div>
          )}

          {/* Face Recognition Matches (face-api.js) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                <span>Face Recognition Matches (Top 3):</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startQrScanner()}
                  className="text-xs text-teal-400 hover:text-teal-300 font-medium underline flex items-center gap-1 cursor-pointer"
                  title="Scan QR Code (Most reliable)"
                >
                  <QrCode className="w-3 h-3" /> Scan QR Pass
                </button>
                <button
                  type="button"
                  onClick={() => setShowSearchModal(true)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline flex items-center gap-1 cursor-pointer"
                >
                  <Search className="w-3 h-3" /> Search Manually
                </button>
              </div>
            </div>

            {/* Multiple faces notice (Requirement 5) */}
            {multipleFacesFound && (
              <div className="px-3 py-1.5 rounded-lg bg-teal-950/70 border border-teal-500/30 text-[11px] text-teal-300 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-teal-400 shrink-0" />
                <span>Multiple faces detected in frame — largest face automatically selected for matching.</span>
              </div>
            )}

            {/* Requirement 8: Clear message when models are loading */}
            {isDetectingFace ? (
              <div className="p-4 rounded-2xl bg-teal-950/60 border border-teal-500/40 text-teal-200 text-xs flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-teal-400 animate-spin shrink-0" />
                <div>
                  <p className="font-semibold">{faceModelStatus || 'Loading face recognition models & computing descriptor...'}</p>
                  <p className="text-[11px] text-teal-300/80">Extracting 128-number face descriptor with TinyFaceDetector in browser</p>
                </div>
              </div>
            ) : faceDetected === false ? (
              /* Requirement 8: Clear message when no face is detected in the scan photo */
              <div className="p-3.5 rounded-2xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <p className="font-semibold">No face detected in scan photo</p>
                    <p className="text-[11px] text-amber-300/80">
                      Ensure student looks directly at camera in good lighting, or scan their QR pass / search manually.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => startQrScanner()}
                    className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" /> Scan QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSearchModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 cursor-pointer"
                  >
                    Search
                  </button>
                </div>
              </div>
            ) : faceMatches.length > 0 ? (
              /* Requirement 3: Top 3 matches with match percentage & distance */
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {faceMatches.slice(0, 3).map((candidate) => {
                  const isSelected = selectedStudent?.gr === candidate.student.gr;
                  const isStrong = candidate.matchType === 'strong';
                  const isPossible = candidate.matchType === 'possible';

                  return (
                    <button
                      key={candidate.student.gr}
                      type="button"
                      onClick={() => {
                        setSelectedStudent(candidate.student);
                        setIsStudentConfirmed(false);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 cursor-pointer relative ${
                        isSelected
                          ? 'bg-emerald-950/70 border-emerald-500 shadow-md shadow-emerald-900/30 ring-1 ring-emerald-500'
                          : 'bg-slate-800/60 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {candidate.student.photoUrl ? (
                        <img
                          src={candidate.student.photoUrl}
                          alt={candidate.student.name}
                          className="w-11 h-11 rounded-lg object-cover border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-100 truncate">
                          {candidate.student.name}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          GR: {candidate.student.gr} • H-{candidate.student.hostel}
                        </p>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                              isStrong
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : isPossible
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-slate-700 text-slate-400'
                            }`}
                          >
                            {isStrong
                              ? `Strong match (${candidate.percentage}%)`
                              : isPossible
                              ? `Possible match (${candidate.percentage}%)`
                              : `No match (${candidate.percentage}%)`}
                          </span>
                          <span className="text-[9px] font-mono text-slate-500">
                            d: {candidate.distance.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                <span>No registered student matches found. Pick student manually or scan QR.</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startQrScanner()}
                    className="px-2.5 py-1 rounded-lg bg-teal-600/80 text-white text-xs font-semibold cursor-pointer"
                  >
                    Scan QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSearchModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/80 text-white text-xs font-semibold cursor-pointer"
                  >
                    Pick Student
                  </button>
                </div>
              </div>
            )}

            {/* Requirement 4: Always ask staff to confirm the selected student before saving. Never save automatically on a weak match. */}
            {selectedStudent && (
              <div className="mt-2">
                {isQrVerified ? (
                  <div className="p-2.5 rounded-xl bg-teal-950/70 border border-teal-500/40 text-xs text-teal-200 flex items-center justify-between gap-2 shadow-sm">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                      <span>
                        Verified via QR code: <strong>{selectedStudent.name}</strong> ({selectedStudent.gr})
                      </span>
                    </div>
                    <span className="text-[10px] text-teal-300 bg-teal-900/60 px-2 py-0.5 rounded font-semibold">
                      Reliable QR
                    </span>
                  </div>
                ) : isStudentConfirmed ? (
                  <div className="p-2.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between gap-2 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        ✓ Confirmed by Staff: <strong>{selectedStudent.name}</strong> ({selectedStudent.gr})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsStudentConfirmed(false)}
                      className="text-[10px] text-emerald-300 hover:text-white underline cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-2xl bg-amber-950/80 border border-amber-500/60 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <p className="font-bold text-amber-100">
                          Confirm Student: {selectedStudent.name} ({selectedStudent.gr})
                        </p>
                        <p className="text-[11px] text-amber-300/80">
                          Hostel {selectedStudent.hostel}. Staff confirmation is required before saving.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsStudentConfirmed(true)}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95 shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm Student</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Waste Level Selection (4 Colored Touch Buttons) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Food Waste Level:
              </label>
              {isAnalyzingPlate ? (
                <span className="text-[11px] text-teal-300 flex items-center gap-1 animate-pulse">
                  <Sparkles className="w-3 h-3 text-teal-400" />
                  Gemini estimating plate leftovers...
                </span>
              ) : selectedWasteLevel ? (
                <span className="text-[11px] text-slate-400">
                  Estimated: <strong className="text-slate-200">{selectedWasteLevel} Waste</strong>
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(['None', 'Low', 'Medium', 'High'] as WasteLevel[]).map((level) => {
                const meta = WASTE_LEVEL_META[level];
                const Icon = meta.icon;
                const isSelected = selectedWasteLevel === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setSelectedWasteLevel(level)}
                    className={`min-h-[56px] h-14 sm:h-16 px-3 py-2 rounded-2xl font-bold transition-all flex flex-col items-center justify-center gap-1 cursor-pointer border active:scale-95 ${
                      isSelected
                        ? meta.btnActiveDark
                        : meta.btnInactiveDark
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm font-extrabold">{meta.label}</span>
                    </div>
                    <span className="text-[10px] font-medium opacity-80">{meta.sublabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Reason / Observation Note */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-400">
              Leftover Notes / AI Observation:
            </label>
            <input
              type="text"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="e.g., Uneaten half bowl of rice and a chapati"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Save Record Button (Fast Save & Instant Reset) */}
          <div className="pt-2">
            {!selectedStudent ? (
              <button
                type="button"
                disabled
                className="w-full min-h-[56px] h-14 px-4 rounded-2xl font-bold text-sm tracking-wide bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed flex items-center justify-center gap-2"
              >
                <span>Select or Scan Student to Save</span>
              </button>
            ) : !isStudentConfirmed && !isQrVerified ? (
              <button
                type="button"
                onClick={() => setIsStudentConfirmed(true)}
                className="w-full min-h-[56px] h-14 px-4 rounded-2xl font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-amber-600 to-orange-500 hover:opacity-95 text-white active:scale-98 transition-all"
              >
                <Check className="w-5 h-5" />
                <span>Confirm {selectedStudent.name} & Enable Save</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveRecord}
                className="w-full min-h-[56px] h-14 px-4 rounded-2xl font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 text-white hover:opacity-95 shadow-emerald-950/50"
              >
                <Check className="w-5 h-5" />
                <span>Save Record ({selectedWasteLevel.toUpperCase()} Waste)</span>
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Quick Success Animation Overlay on Save */}
      <AnimatePresence>
        {showSaveSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none p-4"
          >
            <motion.div
              initial={{ scale: 0.8, y: 10 }}
              animate={{ scale: [0.8, 1.08, 1], y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="bg-slate-900 border-2 border-emerald-500/80 rounded-3xl p-6 flex flex-col items-center gap-3 shadow-2xl shadow-emerald-950/70 text-center max-w-xs w-full"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-inner">
                <Check className="w-9 h-9 stroke-[3]" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-white">Record Saved!</h3>
                <p className="text-xs text-emerald-300 font-medium mt-0.5">
                  Returning to camera...
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Student Search Modal */}
      <AnimatePresence>
        {showSearchModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <User className="w-4 h-4 text-emerald-400" />
                  Select Registered Student
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSearchModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 border-b border-slate-800">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by student name or GR number..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                    autoFocus
                  />
                </div>
              </div>

              <div className="overflow-y-auto p-3 space-y-2 flex-1">
                {filteredSearchStudents.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-6">
                    No matching student found. Add students in the Students tab.
                  </p>
                ) : (
                  filteredSearchStudents.map((s) => (
                    <button
                      key={s.gr}
                      type="button"
                      onClick={() => {
                        setSelectedStudent(s);
                        setShowSearchModal(false);
                      }}
                      className="w-full p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-left flex items-center gap-3 border border-slate-700/60 transition-colors cursor-pointer"
                    >
                      {s.photoUrl ? (
                        <img
                          src={s.photoUrl}
                          alt={s.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-600 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-100 truncate">
                          {s.name}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          GR: {s.gr} • Hostel {s.hostel}
                        </p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                        Select
                      </span>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* QR CODE SCANNER MODAL */}
      <AnimatePresence>
        {isQrScanning && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-teal-500/50 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
                    <QrCode className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Scan Student QR Pass
                    </h3>
                    <p className="text-[10px] text-teal-400">
                      Hold ID card QR code in front of camera
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopQrScanner}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Viewfinder Area */}
              <div className="relative aspect-square bg-black overflow-hidden flex items-center justify-center">
                <video
                  ref={qrVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    qrCameraFacing === 'user' ? 'scale-x-[-1]' : ''
                  }`}
                />

                {/* Animated Targeting Reticle */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
                  <div className="w-56 h-56 border-2 border-teal-400 rounded-2xl relative shadow-[0_0_20px_rgba(20,184,166,0.3)]">
                    {/* Corner Marks */}
                    <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-teal-300 rounded-tl" />
                    <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-teal-300 rounded-tr" />
                    <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-teal-300 rounded-bl" />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-teal-300 rounded-br" />

                    {/* Scanning beam line */}
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-teal-400 to-transparent absolute top-1/2 -translate-y-1/2 animate-pulse" />
                  </div>
                </div>

                {/* Camera Flip Button */}
                <button
                  type="button"
                  onClick={toggleQrCameraFacing}
                  className="absolute top-3 right-3 px-2.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-slate-200 backdrop-blur-md border border-slate-700/60 shadow-lg flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                  title="Flip camera"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
                  <span>{qrCameraFacing === 'environment' ? 'Front' : 'Back'}</span>
                </button>

                {/* QR Error Display if any */}
                {qrScanError && (
                  <div className="absolute bottom-3 inset-x-3 bg-rose-950/90 border border-rose-500/60 rounded-xl p-2.5 text-[11px] text-rose-200 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="flex-1 leading-tight">{qrScanError}</span>
                  </div>
                )}
              </div>

              {/* QR Upload Fallback & Footer */}
              <div className="p-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
                <input
                  ref={qrFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleQrImageUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => qrFileInputRef.current?.click()}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-teal-400" />
                  <span>Upload QR photo</span>
                </button>

                <button
                  type="button"
                  onClick={stopQrScanner}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mandatory Data Privacy Notice */}
      <div className="text-center pt-2">
        <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
          Student photos are used only for mess wastage records.
        </p>
      </div>
    </div>
  );
};
