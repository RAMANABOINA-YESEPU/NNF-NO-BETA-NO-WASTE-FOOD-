/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Camera,
  Users,
  ClipboardList,
  FileText,
  Lock,
  Sun,
  Moon,
  UtensilsCrossed,
  CheckCircle,
  AlertCircle,
  Info,
  Clock,
  Sparkles,
  Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, isFirebaseConfigured } from './firebase';
import { Student, WasteRecord, MealSession } from './types';
import { getMealSessionByTime } from './utils/imageUtils';
import { seedInitialStudentsIfEmpty } from './utils/seedData';
import { PinScreen } from './components/PinScreen';
import { ScanTab } from './components/ScanTab';
import { StudentsTab } from './components/StudentsTab';
import { RecordsTab } from './components/RecordsTab';
import { ReportsTab } from './components/ReportsTab';
import { ConfigMissingBanner } from './components/ConfigMissingBanner';

type TabType = 'scan' | 'students' | 'records' | 'reports';

interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export default function App() {
  // Staff PIN Authentication state (per session)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  // Active Bottom / Sidebar Nav Tab
  const [activeTab, setActiveTab] = useState<TabType>('scan');

  // Theme: Dark mode default (mess staff night/dim environment friendly), remembered in localStorage
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('nnf_theme');
      if (saved !== null) return saved === 'dark';
      return true; // Default dark
    } catch {
      return true;
    }
  });

  // Keep localStorage and documentElement synced
  useEffect(() => {
    try {
      localStorage.setItem('nnf_theme', isDarkMode ? 'dark' : 'light');
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [isDarkMode]);

  // Firestore Data State
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<WasteRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);

  // Backend / Gemini Health Status
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean>(true);

  // Toast Notification state
  const [toasts, setToasts] = useState<ToastState[]>([]);

  // Current session based on time
  const [currentSession, setCurrentSession] = useState<MealSession>(getMealSessionByTime());

  // Check backend health
  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHasGeminiKey(Boolean(data.hasGeminiKey));
      }
    } catch {
      // Backend check error
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  // Sync current meal session periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSession(getMealSessionByTime());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Toast Notification helper
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  // Subscribe to Firestore collections (Students and Waste Records)
  useEffect(() => {
    if (!db) {
      setIsLoadingData(false);
      return;
    }

    // 1. Subscribe to Students
    const studentsUnsub = onSnapshot(
      collection(db, 'students'),
      async (snapshot) => {
        if (snapshot.empty) {
          // If Firestore has no students yet, auto-seed with sample roster
          const seeded = await seedInitialStudentsIfEmpty();
          setStudents(seeded);
        } else {
          const list: Student[] = [];
          snapshot.forEach((docSnap) => {
            list.push({ gr: docSnap.id, ...(docSnap.data() as any) });
          });
          // Sort alphabetically by name
          list.sort((a, b) => a.name.localeCompare(b.name));
          setStudents(list);
        }
        setIsLoadingData(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'students');
        setIsLoadingData(false);
      }
    );

    // 2. Subscribe to Waste Records
    const recordsUnsub = onSnapshot(
      collection(db, 'waste_records'),
      (snapshot) => {
        const list: WasteRecord[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        // Sort descending by timestamp
        list.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setRecords(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'waste_records');
      }
    );

    return () => {
      studentsUnsub();
      recordsUnsub();
    };
  }, []);

  // If not authenticated via staff PIN screen, show PIN keypad
  if (!isAuthenticated) {
    return <PinScreen onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${
        isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Missing configuration notice banner if keys are absent */}
      <ConfigMissingBanner
        hasGeminiKey={hasGeminiKey}
        onRefresh={checkHealth}
      />

      {/* Main Responsive Layout Wrapper: Side Nav on Desktop (lg:), Top/Bottom on Mobile */}
      <div className="min-h-screen lg:flex">
        {/* DESKTOP SIDEBAR (Visible only on lg and above) */}
        <aside
          className={`hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen border-r backdrop-blur-xl transition-colors z-40 ${
            isDarkMode
              ? 'bg-slate-900/95 border-slate-800'
              : 'bg-white/95 border-slate-200'
          }`}
        >
          {/* Desktop Brand & Logo */}
          <div className="p-5 border-b border-inherit flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-lg shadow-emerald-500/20 shrink-0 flex items-center justify-center">
              <div
                className={`w-full h-full rounded-[14px] flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-950' : 'bg-white'
                }`}
              >
                <UtensilsCrossed className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent truncate">
                  NNF Mess
                </h1>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {currentSession}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium truncate">
                No Beta No Waste Food
              </p>
            </div>
          </div>

          {/* Desktop Nav Links */}
          <div className="p-3 space-y-1.5 flex-1">
            {[
              { id: 'scan' as TabType, label: 'Camera & Scan', icon: Camera, badge: null },
              { id: 'students' as TabType, label: 'Student Roster', icon: Users, badge: students.length },
              { id: 'records' as TabType, label: 'Waste Records', icon: ClipboardList, badge: records.length },
              { id: 'reports' as TabType, label: 'Audit Reports', icon: FileText, badge: null },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-emerald-950/40 scale-[1.02]'
                      : isDarkMode
                      ? 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span className="tracking-tight">{tab.label}</span>
                  </div>
                  {tab.badge !== null && tab.badge > 0 && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : isDarkMode
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Desktop Sidebar Bottom Footer: Counter status, Theme Toggle, Lock, Founder Credit */}
          <div className="p-4 border-t border-inherit space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`p-2.5 rounded-xl border flex-1 flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                }`}
                title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
              </button>

              <button
                onClick={() => setIsAuthenticated(false)}
                className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                }`}
                title="Lock staff counter"
              >
                <Lock className="w-4 h-4 text-rose-400" />
                <span>Lock</span>
              </button>
            </div>

            {/* Desktop Founder Credit */}
            <div className="pt-2 text-center select-none">
              <p className="text-[11px] font-semibold text-emerald-400/90 leading-tight">
                NNF – No Beta No Waste Food
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Founded by Yesepu Ramanaboina
              </p>
            </div>
          </div>
        </aside>

        {/* MAIN BODY AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Modern Gradient Mobile/Tablet Header */}
          <header
            className={`sticky top-0 z-40 backdrop-blur-xl border-b transition-colors ${
              isDarkMode
                ? 'bg-slate-900/80 border-slate-800/80'
                : 'bg-white/80 border-slate-200'
            }`}
          >
            <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
              {/* Logo & Brand */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-md shadow-emerald-500/20 shrink-0 flex items-center justify-center">
                  <div
                    className={`w-full h-full rounded-[10px] flex items-center justify-center ${
                      isDarkMode ? 'bg-slate-950' : 'bg-white'
                    }`}
                  >
                    <UtensilsCrossed className="w-5 h-5 text-emerald-500" />
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-base font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent truncate">
                      NNF
                    </h1>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {currentSession}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium truncate">
                    No Beta No Waste Food
                  </p>
                </div>
              </div>

              {/* Quick Header Actions: Dark Mode & Lock App */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Theme Toggle (Mobile/Tablet) */}
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                  title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>

                {/* Lock Session Button */}
                <button
                  onClick={() => setIsAuthenticated(false)}
                  className={`px-2.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isDarkMode
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                  title="Lock staff counter"
                >
                  <Lock className="w-3.5 h-3.5 text-rose-400" />
                  <span className="hidden sm:inline">Lock PIN</span>
                </button>
              </div>
            </div>
          </header>

          {/* Main Content Area */}
          <main className="max-w-4xl mx-auto px-4 pt-4 pb-28 lg:pb-12 w-full flex-1">
            {isLoadingData ? (
              /* Skeleton Loader */
              <div className="space-y-4 py-4 animate-pulse">
                <div
                  className={`h-24 rounded-2xl border ${
                    isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
                  }`}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className={`h-36 rounded-2xl border ${
                        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-center text-xs text-slate-400 font-medium pt-2">
                  Loading NNF records & student database...
                </p>
              </div>
            ) : (
              <>
                {activeTab === 'scan' && (
                  <ScanTab
                    students={students}
                    onRecordSaved={(newRecord) => {
                      setRecords((prev) => [newRecord, ...prev]);
                    }}
                    showToast={showToast}
                    currentSession={currentSession}
                    onSessionChange={setCurrentSession}
                    scannedTodayCount={
                      records.filter(
                        (r) =>
                          r.timestamp &&
                          r.timestamp.startsWith(new Date().toISOString().split('T')[0])
                      ).length
                    }
                  />
                )}

                {activeTab === 'students' && (
                  <StudentsTab
                    students={students}
                    onStudentsChange={(updatedList) => setStudents(updatedList)}
                    showToast={showToast}
                  />
                )}

                {activeTab === 'records' && (
                  <RecordsTab
                    records={records}
                    students={students}
                    onRecordsChange={(updated) => setRecords(updated)}
                    showToast={showToast}
                  />
                )}

                {activeTab === 'reports' && (
                  <ReportsTab records={records} showToast={showToast} />
                )}

                {/* Requirement 1: Founder Credit Footer on every screen (Scan, Students, Records, Reports) */}
                <footer
                  className={`mt-8 pt-4 pb-2 border-t text-center select-none ${
                    isDarkMode
                      ? 'border-slate-800/80 text-slate-400'
                      : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <p className="text-[11px] sm:text-xs font-medium tracking-tight">
                    NNF – No Beta No Waste Food · Founded by Yesepu Ramanaboina
                  </p>
                </footer>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Mobile/Tablet Sticky Bottom Navigation Dock (Hidden on lg: desktop screens) */}
      <nav
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl border-t transition-colors safe-area-pb ${
          isDarkMode
            ? 'bg-slate-900/90 border-slate-800/80 shadow-2xl shadow-black'
            : 'bg-white/90 border-slate-200 shadow-2xl shadow-slate-200'
        }`}
      >
        <div className="max-w-md mx-auto grid grid-cols-4 px-2 py-2">
          {/* TAB 1: SCAN */}
          <button
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer ${
              activeTab === 'scan'
                ? 'text-emerald-400 font-bold scale-105'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200 font-medium'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${
                activeTab === 'scan'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-sm shadow-emerald-500/30'
                  : ''
              }`}
            >
              <Camera className="w-5 h-5" />
            </div>
            <span className="text-[11px] mt-1 tracking-tight">Scan</span>
          </button>

          {/* TAB 2: STUDENTS */}
          <button
            onClick={() => setActiveTab('students')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer relative ${
              activeTab === 'students'
                ? 'text-emerald-400 font-bold scale-105'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200 font-medium'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${
                activeTab === 'students'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-sm shadow-emerald-500/30'
                  : ''
              }`}
            >
              <Users className="w-5 h-5" />
            </div>
            <span className="text-[11px] mt-1 tracking-tight">Students</span>
            {students.length > 0 && (
              <span className="absolute top-1 right-3 text-[9px] font-bold px-1 rounded-full bg-slate-800 text-slate-300">
                {students.length}
              </span>
            )}
          </button>

          {/* TAB 3: RECORDS */}
          <button
            onClick={() => setActiveTab('records')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer relative ${
              activeTab === 'records'
                ? 'text-emerald-400 font-bold scale-105'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200 font-medium'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${
                activeTab === 'records'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-sm shadow-emerald-500/30'
                  : ''
              }`}
            >
              <ClipboardList className="w-5 h-5" />
            </div>
            <span className="text-[11px] mt-1 tracking-tight">Records</span>
            {records.length > 0 && (
              <span className="absolute top-1 right-3 text-[9px] font-bold px-1 rounded-full bg-slate-800 text-slate-300">
                {records.length}
              </span>
            )}
          </button>

          {/* TAB 4: REPORTS */}
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all cursor-pointer ${
              activeTab === 'reports'
                ? 'text-emerald-400 font-bold scale-105'
                : isDarkMode
                ? 'text-slate-400 hover:text-slate-200 font-medium'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-colors ${
                activeTab === 'reports'
                  ? 'bg-emerald-500/20 text-emerald-400 shadow-sm shadow-emerald-500/30'
                  : ''
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <span className="text-[11px] mt-1 tracking-tight">Reports</span>
          </button>
        </div>
      </nav>

      {/* Toast Notification Container */}
      <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={`p-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-md pointer-events-auto ${
                toast.type === 'success'
                  ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50 shadow-emerald-950/50'
                  : toast.type === 'error'
                  ? 'bg-rose-950/90 text-rose-200 border-rose-500/50 shadow-rose-950/50'
                  : 'bg-slate-900/90 text-slate-200 border-slate-700 shadow-slate-950/50'
              }`}
            >
              {toast.type === 'success' && (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              {toast.type === 'error' && (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              {toast.type === 'info' && (
                <Info className="w-4 h-4 text-cyan-400 shrink-0" />
              )}
              <span className="flex-1">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
