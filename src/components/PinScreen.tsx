import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Lock,
  Delete,
  CheckCircle2,
  AlertCircle,
  Utensils,
  KeyRound,
  HelpCircle,
  RefreshCw,
  Key,
  X,
  ShieldAlert,
  Database,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, databaseId, activeConfig, isFirebaseConfigured, missingFirebaseConfigs } from '../firebase';
import { hashPin } from '../utils/imageUtils';

interface PinScreenProps {
  onAuthenticated: () => void;
}

interface FirebaseErrorDetails {
  code?: string;
  message: string;
}

export const PinScreen: React.FC<PinScreenProps> = ({ onAuthenticated }) => {
  const [pin, setPin] = useState<string>('');
  const [firstPin, setFirstPin] = useState<string>('');
  const [step, setStep] = useState<'enter' | 'create' | 'confirm'>('enter');
  const [storedHash, setStoredHash] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [firestoreError, setFirestoreError] = useState<FirebaseErrorDetails | null>(null);

  // Forgot PIN / Admin Reset State
  const [showForgotModal, setShowForgotModal] = useState<boolean>(false);
  const [adminCodeInput, setAdminCodeInput] = useState<string>('');
  const [adminCodeError, setAdminCodeError] = useState<string>('');
  const [resetSuccessNotice, setResetSuccessNotice] = useState<string>('');

  const adminResetCode = (
    import.meta.env.VITE_ADMIN_RESET_CODE || '8888'
  ).toString().trim();

  // Check if PIN exists in Firestore
  const checkPinSetup = async () => {
    setIsLoading(true);
    setFirestoreError(null);
    setErrorMsg('');

    if (!isFirebaseConfigured || !db) {
      setFirestoreError({
        code: 'config/not-ready',
        message: 'Built-in Firebase configuration is missing or not ready. Please refresh the page.',
      });
      setIsLoading(false);
      return;
    }

    try {
      const pinDocRef = doc(db, 'settings', 'pin');
      const snap = await getDoc(pinDocRef);

      if (snap.exists() && snap.data()?.pinHash) {
        setStoredHash(snap.data().pinHash);
        setStep('enter');
      } else {
        // Document does not exist in Firestore: First launch!
        setStoredHash(null);
        setStep('create');
      }
    } catch (err: any) {
      console.error('Firestore getDoc error on settings/pin:', err);
      const code = err?.code || (err?.name !== 'Error' ? err?.name : undefined);
      const message = err?.message || String(err);
      setFirestoreError({
        code: code || 'firestore/connection-error',
        message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkPinSetup();
  }, []);

  const triggerShake = (msg: string) => {
    setErrorMsg(msg);
    setIsShaking(true);
    if (navigator.vibrate) {
      navigator.vibrate([80, 50, 80]);
    }
    setTimeout(() => {
      setIsShaking(false);
      setPin('');
    }, 600);
  };

  const handleKeyPress = async (digit: string) => {
    if (isShaking || isLoading || firestoreError) return;
    if (pin.length >= 4) return;

    const newPin = pin + digit;
    setPin(newPin);
    setErrorMsg('');

    if (newPin.length === 4) {
      if (step === 'enter') {
        // Checking existing PIN against stored hash
        if (!storedHash) {
          triggerShake('No PIN registered yet. Please reload or contact admin.');
          return;
        }

        const hashed = await hashPin(newPin);
        if (hashed === storedHash) {
          onAuthenticated();
        } else {
          triggerShake('Incorrect Staff PIN. Please try again.');
        }
      } else if (step === 'create') {
        // First entry of new PIN -> advance to confirmation
        setFirstPin(newPin);
        setPin('');
        setStep('confirm');
      } else if (step === 'confirm') {
        // Second entry of new PIN -> verify match
        if (newPin === firstPin) {
          try {
            setIsLoading(true);
            const hashed = await hashPin(newPin);
            await setDoc(doc(db, 'settings', 'pin'), {
              pinHash: hashed,
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            });
            setStoredHash(hashed);
            onAuthenticated();
          } catch (err: any) {
            console.error('Error saving PIN to Firestore:', err);
            const code = err?.code || (err?.name !== 'Error' ? err?.name : undefined);
            const message = err?.message || String(err);
            setFirestoreError({
              code: code || 'firestore/write-error',
              message: `Failed saving PIN to Firestore: ${message}`,
            });
            setStep('create');
            setFirstPin('');
            setPin('');
          } finally {
            setIsLoading(false);
          }
        } else {
          triggerShake('PINs do not match. Please re-enter.');
          setTimeout(() => {
            setStep('create');
            setFirstPin('');
            setPin('');
          }, 800);
        }
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
      setErrorMsg('');
    }
  };

  const handleClear = () => {
    setPin('');
    setErrorMsg('');
  };

  // Handle Admin Reset Code Submission
  const handleVerifyAdminCode = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminCodeError('');
    const entered = adminCodeInput.trim();

    if (!entered) {
      setAdminCodeError('Please enter the admin reset code.');
      return;
    }

    if (entered === adminResetCode) {
      // Admin verified! Allow staff to create a fresh PIN
      setShowForgotModal(false);
      setAdminCodeInput('');
      setStep('create');
      setFirstPin('');
      setPin('');
      setResetSuccessNotice('Admin code verified! Please set a new 4-digit staff PIN.');
      setTimeout(() => setResetSuccessNotice(''), 6000);
    } else {
      setAdminCodeError('Invalid Admin Reset Code. Contact mess supervisor or warden.');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-between items-center p-6 text-slate-100">
        <div />
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4 mx-auto" />
          <p className="text-slate-300 font-semibold text-sm">
            Checking Hostel Mess PIN status...
          </p>
          <p className="text-slate-500 text-xs mt-1">Connecting to Firestore ({databaseId})...</p>
        </div>
        <footer className="w-full max-w-sm text-center py-2.5 border-t border-slate-800/60">
          <p className="text-[11px] font-medium text-slate-400 tracking-tight">
            NNF – No Beta No Waste Food · Founded by Yesepu Ramanaboina
          </p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 flex flex-col justify-between items-center p-4 sm:p-6 text-slate-100 select-none">
      {/* Top Header & Branding */}
      <div className="w-full max-w-sm pt-4 sm:pt-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-lg shadow-emerald-500/20 mb-3 flex items-center justify-center">
          <div className="w-full h-full bg-slate-950/80 rounded-[14px] flex items-center justify-center backdrop-blur-sm">
            <Utensils className="w-8 h-8 text-emerald-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
          NNF – No Beta No Waste Food
        </h1>
        <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">
          Hostel Mess Staff Portal
        </p>

        {/* Exact Firebase Error Code and Message Display */}
        {firestoreError && (
          <div className="w-full mt-4 p-3.5 rounded-2xl bg-rose-950/80 border border-rose-500/60 text-left text-xs text-rose-200 shadow-xl space-y-2.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-rose-300">Firebase Error</span>
                  {firestoreError.code && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-900/80 text-rose-200 border border-rose-700/60">
                      {firestoreError.code}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-rose-200/90 break-words mt-1 leading-relaxed font-sans">
                  {firestoreError.message}
                </p>
                <div className="mt-2 pt-2 border-t border-rose-800/40 text-[10px] text-rose-300/70 font-mono space-y-0.5">
                  <p>Database: {databaseId}</p>
                  <p>Project: {activeConfig.projectId || 'Not set'}</p>
                </div>
              </div>
            </div>
            <button
              onClick={checkPinSetup}
              className="w-full py-2 px-3 rounded-xl bg-rose-800 hover:bg-rose-700 active:scale-98 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry Firestore Connection
            </button>
          </div>
        )}

        {/* Admin reset success toast banner */}
        {resetSuccessNotice && (
          <div className="w-full mt-3 p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{resetSuccessNotice}</span>
          </div>
        )}

        {/* Step indicator header */}
        <div className="mt-5 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs text-slate-200 shadow-inner">
          {step === 'enter' && (
            <>
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Enter 4-Digit Staff PIN</span>
            </>
          )}
          {step === 'create' && (
            <>
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Step 1 of 2: Create 4-Digit Staff PIN</span>
            </>
          )}
          {step === 'confirm' && (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Step 2 of 2: Re-enter PIN to Confirm</span>
            </>
          )}
        </div>

        {/* PIN Indicators Dots with Shake Animation */}
        <motion.div
          animate={isShaking ? { x: [-12, 12, -10, 10, -6, 6, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-4 my-7"
        >
          {[0, 1, 2, 3].map((index) => {
            const isFilled = pin.length > index;
            return (
              <motion.div
                key={index}
                animate={{
                  scale: isFilled ? [1, 1.25, 1] : 1,
                  backgroundColor: isFilled ? '#10b981' : 'transparent',
                }}
                transition={{ duration: 0.15 }}
                className={`w-4 h-4 rounded-full border-2 transition-colors duration-150 ${
                  isFilled
                    ? 'border-emerald-400 bg-emerald-500 shadow-lg shadow-emerald-500/50'
                    : 'border-slate-600 bg-slate-800/50'
                }`}
              />
            );
          })}
        </motion.div>

        {/* Dynamic Error message or prompt subtitle */}
        <div className="h-6">
          <AnimatePresence>
            {errorMsg ? (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-1.5 text-xs text-rose-400 font-semibold"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </motion.div>
            ) : step === 'create' ? (
              <p className="text-xs text-amber-300 font-medium">
                Choose any 4-digit code for mess staff access
              </p>
            ) : step === 'confirm' ? (
              <p className="text-xs text-emerald-300 font-medium">
                Type the same 4 digits to confirm
              </p>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Number Keypad */}
      <div className="w-full max-w-xs pb-4">
        <div className="grid grid-cols-3 gap-3.5 sm:gap-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleKeyPress(digit)}
              disabled={Boolean(firestoreError)}
              className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-600 active:scale-95 text-2xl font-semibold text-slate-100 border border-slate-700/60 shadow-md transition-all flex items-center justify-center focus:outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {digit}
            </button>
          ))}

          {/* Clear Button */}
          <button
            type="button"
            onClick={handleClear}
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800/70 active:scale-95 text-xs uppercase font-bold tracking-wider text-slate-400 border border-slate-800 transition-all flex items-center justify-center focus:outline-none cursor-pointer"
          >
            Clear
          </button>

          {/* 0 Button */}
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            disabled={Boolean(firestoreError)}
            className="h-16 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-600 active:scale-95 text-2xl font-semibold text-slate-100 border border-slate-700/60 shadow-md transition-all flex items-center justify-center focus:outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            0
          </button>

          {/* Backspace Button */}
          <button
            type="button"
            onClick={handleDelete}
            aria-label="Delete last digit"
            className="h-16 rounded-2xl bg-slate-800/40 hover:bg-slate-800/70 active:scale-95 text-slate-300 border border-slate-800 transition-all flex items-center justify-center focus:outline-none cursor-pointer"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        {/* Forgot PIN Action */}
        {step === 'enter' && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setAdminCodeError('');
                setAdminCodeInput('');
                setShowForgotModal(true);
              }}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold underline inline-flex items-center gap-1 cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Forgot PIN? (Admin Reset)</span>
            </button>
          </div>
        )}

        {/* Footer Note */}
        <p className="text-[11px] text-center text-slate-500 mt-4 flex items-center justify-center gap-1">
          <Shield className="w-3 h-3 text-slate-400" />
          Shared mess counter security. Saved permanently in Firestore.
        </p>

        {/* Requirement 1: Founder Credit Footer on PIN Screen */}
        <footer className="w-full text-center py-2.5 mt-3 border-t border-slate-800/60">
          <p className="text-[11px] font-medium text-slate-400 tracking-tight">
            NNF – No Beta No Waste Food · Founded by Yesepu Ramanaboina
          </p>
        </footer>
      </div>

      {/* Forgot PIN / Admin Reset Modal */}
      <AnimatePresence>
        {showForgotModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Reset Staff PIN
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Mess manager / warden authorization
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowForgotModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleVerifyAdminCode} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Enter Admin Reset Code:
                  </label>
                  <input
                    type="password"
                    autoFocus
                    value={adminCodeInput}
                    onChange={(e) => setAdminCodeInput(e.target.value)}
                    placeholder="Enter reset code..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500 font-mono tracking-widest text-center"
                  />
                  <p className="text-[10px] text-slate-500">
                    Configured via <code className="text-slate-400">VITE_ADMIN_RESET_CODE</code>
                  </p>
                </div>

                {adminCodeError && (
                  <p className="text-xs text-rose-400 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{adminCodeError}</span>
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Verify Code</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
