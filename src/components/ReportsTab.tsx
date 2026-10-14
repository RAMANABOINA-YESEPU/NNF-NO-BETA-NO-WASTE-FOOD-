import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Share2,
  Calendar,
  CheckCircle,
  Filter,
  Flame,
  Clock,
  Printer,
  Sparkles,
  ExternalLink,
  Users,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, setDoc, getDocs, query } from 'firebase/firestore';
import { db } from '../firebase';
import { WasteRecord, SavedReport, MealSession } from '../types';
import { generateWastePdfReport } from '../utils/pdfGenerator';
import { uploadPhoto } from '../utils/imageUtils';

interface ReportsTabProps {
  records: WasteRecord[];
  showToast: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({ records, showToast }) => {
  const [reportDate, setReportDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [reportSession, setReportSession] = useState<MealSession | 'All'>('All');
  const [reportHostel, setReportHostel] = useState<string>('All');
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Latest generated PDF blob state for direct opening and Web Share fallback
  const [lastGeneratedPdf, setLastGeneratedPdf] = useState<{
    blob: Blob;
    objectUrl: string;
    fileName: string;
    sizeFormatted: string;
  } | null>(null);

  // Past reports history
  const [pastReports, setPastReports] = useState<SavedReport[]>([]);
  const [isLoadingPastReports, setIsLoadingPastReports] = useState<boolean>(true);

  // Load past saved reports from Firestore
  useEffect(() => {
    async function fetchPastReports() {
      if (!db) {
        setIsLoadingPastReports(false);
        return;
      }
      try {
        const q = query(collection(db, 'reports'));
        const snap = await getDocs(q);
        const list: SavedReport[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as any) });
        });
        list.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setPastReports(list);
      } catch (err: any) {
        console.warn('Failed loading past reports from Firestore:', err);
      } finally {
        setIsLoadingPastReports(false);
      }
    }

    fetchPastReports();
  }, []);

  // Filter records candidate for the report
  const candidateRecords = records.filter((r) => {
    const recordDate = r.timestamp ? r.timestamp.split('T')[0] : '';
    if (recordDate !== reportDate) return false;
    if (reportSession !== 'All' && r.session !== reportSession) return false;
    if (reportHostel !== 'All' && r.hostel !== reportHostel) return false;
    // Medium and High waste only
    if (r.wasteLevel !== 'Medium' && r.wasteLevel !== 'High') return false;
    if (verifiedOnly && !r.isVerified) return false;
    return true;
  });

  // Hostel Breakdown of Candidates
  const hostels = ['A', 'B', 'C', 'D', 'Other'] as const;
  const hostelBreakdown = hostels.map((h) => ({
    hostel: h,
    count: candidateRecords.filter((r) => r.hostel === h).length,
  }));

  // Handle PDF Generation
  const handleGeneratePdf = async () => {
    if (candidateRecords.length === 0) {
      showToast('No Medium or High waste records match this criteria.', 'error');
      return;
    }

    try {
      setIsGenerating(true);
      setGenerationProgress(15);
      setGenerationError(null);
      showToast('Processing photos & generating PDF report...', 'info');

      // Simulate step-by-step progress
      const progressTimer1 = setTimeout(() => setGenerationProgress(45), 300);
      const progressTimer2 = setTimeout(() => setGenerationProgress(80), 800);

      // 1. Build PDF with jsPDF as Blob, with all images pre-loaded via Promise.all
      const { blob, fileName } = await generateWastePdfReport({
        date: reportDate,
        session: reportSession,
        records: candidateRecords,
        verifiedOnly,
      });

      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      setGenerationProgress(100);

      // Format file size
      const sizeKB = Math.round(blob.size / 1024);
      const sizeFormatted = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

      // Create Blob Object URL
      const objectUrl = URL.createObjectURL(blob);
      setLastGeneratedPdf({ blob, objectUrl, fileName, sizeFormatted });

      // 2. Download using temporary <a download="..."> appended to document, clicked, then removed
      let downloadInitiated = false;
      try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        link.setAttribute('download', fileName);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        downloadInitiated = true;
      } catch (clickErr: any) {
        console.warn('Direct <a> click was blocked:', clickErr);
      }

      if (downloadInitiated) {
        showToast(`PDF report downloaded (${sizeFormatted})!`, 'success');
      } else {
        showToast('PDF ready! Tap "Open" or "Download" below.', 'info');
      }

      // 3. Save report to Firestore and Storage in background
      try {
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          const reportId = `rep_${Date.now()}`;
          const uploadedPdfUrl = await uploadPhoto(
            base64data,
            `reports/${reportId}.pdf`
          );

          const newReport: SavedReport = {
            id: reportId,
            title: `Waste Audit - ${reportDate} (${reportSession}${reportHostel !== 'All' ? ` - Hostel ${reportHostel}` : ''})`,
            date: reportDate,
            session: reportSession,
            totalRecords: candidateRecords.length,
            pdfUrl: uploadedPdfUrl,
            createdAt: new Date().toISOString(),
          };

          if (db) {
            await setDoc(doc(db, 'reports', reportId), newReport);
          }
          setPastReports((prev) => [newReport, ...prev]);
        };
        reader.readAsDataURL(blob);
      } catch (uploadErr) {
        console.warn('Background save to Firebase skipped:', uploadErr);
      }
    } catch (err: any) {
      console.error('Error generating PDF report:', err);
      const errMsg = err?.message || String(err);
      setGenerationError(errMsg);
      showToast(`PDF generation failed: ${errMsg}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Open PDF in a new browser tab (bypasses iframe download restriction)
  const handleOpenPdfInNewTab = () => {
    if (!lastGeneratedPdf) return;
    try {
      window.open(lastGeneratedPdf.objectUrl, '_blank', 'noopener,noreferrer');
    } catch (openErr: any) {
      showToast(`Failed opening tab: ${openErr?.message || openErr}`, 'error');
    }
  };

  // Direct trigger download
  const handleTriggerDownload = () => {
    if (!lastGeneratedPdf) return;
    try {
      const link = document.createElement('a');
      link.href = lastGeneratedPdf.objectUrl;
      link.download = lastGeneratedPdf.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Downloaded ${lastGeneratedPdf.fileName}`, 'success');
    } catch (err: any) {
      showToast('Download could not be initiated directly.', 'error');
    }
  };

  // Share report via Web Share API with PDF file fallback
  const handleShareReport = async () => {
    const summaryText = `*NNF Hostel Mess Food Wastage Audit Report*\nDate: ${reportDate}\nSession: ${reportSession}\nTotal Flagged Cases: ${candidateRecords.length} students (Medium & High waste).\nSubmitted for warden review.`;

    if (lastGeneratedPdf && navigator.canShare) {
      try {
        const file = new File(
          [lastGeneratedPdf.blob],
          lastGeneratedPdf.fileName,
          { type: 'application/pdf' }
        );
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: lastGeneratedPdf.fileName,
            text: summaryText,
          });
          showToast('PDF shared successfully!', 'success');
          return;
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Web Share file error:', err);
        } else {
          return;
        }
      }
    }

    // Standard text share
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'NNF Mess Food Wastage Audit',
          text: summaryText,
        });
        showToast('Shared successfully!', 'success');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // WhatsApp Fallback
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
      summaryText
    )}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="space-y-4 pb-2">
      {/* Guided Report Configuration Card (Requirement 10) */}
      <div className="bg-slate-900/90 rounded-2xl p-4 sm:p-5 border border-slate-700/60 shadow-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-teal-500/10 text-teal-400 border border-teal-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-100">
              Guided Report Builder
            </h2>
            <p className="text-xs text-slate-400">
              Select date, session, & hostel to generate official audit PDF
            </p>
          </div>
        </div>

        {/* Step 1: Filters (Date, Session, Hostel) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {/* 1. Date */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wide">
              1. Audit Date
            </label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => {
                setReportDate(e.target.value);
                setLastGeneratedPdf(null);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* 2. Session */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wide">
              2. Meal Session
            </label>
            <select
              value={reportSession}
              onChange={(e) => {
                setReportSession(e.target.value as any);
                setLastGeneratedPdf(null);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="All">All Sessions Combined</option>
              <option value="Breakfast">Breakfast</option>
              <option value="Lunch">Lunch</option>
              <option value="Dinner">Dinner</option>
            </select>
          </div>

          {/* 3. Hostel */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1 uppercase tracking-wide">
              3. Hostel Block
            </label>
            <select
              value={reportHostel}
              onChange={(e) => {
                setReportHostel(e.target.value);
                setLastGeneratedPdf(null);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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

        {/* Verified Only Toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800">
          <div className="flex items-center gap-2.5">
            <CheckCircle
              className={`w-4 h-4 ${
                verifiedOnly ? 'text-emerald-400' : 'text-slate-500'
              }`}
            />
            <div>
              <p className="text-xs font-bold text-slate-200">Verified Records Only</p>
              <p className="text-[11px] text-slate-400">
                Include only records flagged as "Verified by manager"
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setVerifiedOnly(!verifiedOnly);
              setLastGeneratedPdf(null);
            }}
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              verifiedOnly ? 'bg-emerald-600' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                verifiedOnly ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* STEP 2: LIVE SUMMARY CARD PREVIEW BEFORE GENERATING (Requirement 10) */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-extrabold text-slate-200 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-orange-400" />
              Live Report Preview:
            </span>
            <span className="text-xs font-extrabold text-orange-400 px-3 py-1 rounded-full bg-orange-950/60 border border-orange-800/50">
              {candidateRecords.length} Student{candidateRecords.length === 1 ? '' : 's'} with Waste
            </span>
          </div>

          {/* Breakdown chips by hostel */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-center text-xs">
            {hostelBreakdown.map((item) => (
              <div
                key={item.hostel}
                className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center"
              >
                <p className="text-[10px] text-slate-400 font-semibold uppercase">
                  Hostel {item.hostel}
                </p>
                <p className="text-base font-extrabold text-slate-100 mt-0.5">
                  {item.count}
                </p>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            {candidateRecords.length === 0
              ? 'No Medium or High waste entries recorded for this selection.'
              : `Ready to compile official ${candidateRecords.length}-student audit report.`}
          </p>
        </div>

        {/* STEP 3: PROGRESS BAR WHILE PDF BUILDS (Requirement 10) */}
        {isGenerating && (
          <div className="p-4 rounded-2xl bg-teal-950/80 border border-teal-500/50 space-y-2">
            <div className="flex items-center justify-between text-xs text-teal-200">
              <span className="font-bold flex items-center gap-2">
                <Printer className="w-4 h-4 animate-spin text-teal-400" />
                Building PDF Report & Rendering Bar Charts...
              </span>
              <span className="font-mono font-bold text-teal-300">{generationProgress}%</span>
            </div>
            {/* Animated Progress Bar */}
            <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-teal-800">
              <div
                className="bg-gradient-to-r from-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${generationProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-teal-300/80">
              Pre-loading evidence photos and generating hostel distribution graphs...
            </p>
          </div>
        )}

        {/* Real Error Message Display if failed */}
        {generationError && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-300">PDF Generation Error</p>
              <p className="text-[11px] text-rose-200/90 break-words mt-0.5 font-mono">
                {generationError}
              </p>
            </div>
          </div>
        )}

        {/* Primary Action Button: Generate PDF */}
        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handleGeneratePdf}
            disabled={isGenerating || candidateRecords.length === 0}
            className={`w-full py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm tracking-wide shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 ${
              candidateRecords.length === 0
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 text-white shadow-emerald-950/50 hover:opacity-95'
            }`}
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Compiling Official PDF...</span>
              </>
            ) : (
              <>
                <Printer className="w-4 h-4" />
                <span>Generate Official PDF ({candidateRecords.length} Students)</span>
              </>
            )}
          </button>

          {/* STEP 4: THREE BUTTONS: DOWNLOAD, SHARE, OPEN (Requirement 10) */}
          {lastGeneratedPdf && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* 1. Download */}
              <button
                type="button"
                onClick={handleTriggerDownload}
                className="py-3 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                <span>Download ({lastGeneratedPdf.sizeFormatted})</span>
              </button>

              {/* 2. Share */}
              <button
                type="button"
                onClick={handleShareReport}
                className="py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-teal-400" />
                <span>Share PDF</span>
              </button>

              {/* 3. Open */}
              <button
                type="button"
                onClick={handleOpenPdfInNewTab}
                className="py-3 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open in Tab</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PAST REPORTS LIST WITH DATE AND FILE SIZE (Requirement 10) */}
      <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/60 shadow-lg space-y-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-teal-400" />
          Past Generated Reports in Firebase
        </h3>

        {isLoadingPastReports ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Loading previous reports from Firestore...
          </div>
        ) : pastReports.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-950/60 rounded-xl border border-slate-800">
            No past reports saved yet. Click "Generate Official PDF" above to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {pastReports.map((rep) => {
              // Estimated size based on photo count: ~70KB base + ~45KB per student
              const estimatedSizeKB = Math.round(70 + rep.totalRecords * 45);
              const sizeLabel = estimatedSizeKB > 1024 ? `${(estimatedSizeKB / 1024).toFixed(1)} MB` : `${estimatedSizeKB} KB`;

              return (
                <div
                  key={rep.id}
                  className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-200 truncate">{rep.title}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {rep.totalRecords} students • {new Date(rep.createdAt).toLocaleDateString()} • <span className="font-mono text-teal-400">{sizeLabel}</span>
                    </p>
                  </div>

                  {rep.pdfUrl ? (
                    <a
                      href={rep.pdfUrl}
                      download={`NNF_Report_${rep.date}.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  ) : (
                    <span className="text-slate-500 text-[10px]">Saved</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
