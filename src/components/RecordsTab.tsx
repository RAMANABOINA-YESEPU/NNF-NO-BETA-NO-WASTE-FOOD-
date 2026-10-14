import React, { useState } from 'react';
import {
  Calendar,
  Filter,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Eye,
  Flame,
  User,
  Clock,
  Sparkles,
  Shield,
  X,
  Check,
  TrendingDown,
  TrendingUp,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Camera,
  SlidersHorizontal,
  UtensilsCrossed,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { WasteRecord, Student, WasteLevel, MealSession, HostelType } from '../types';
import { generateWarningEvidencePdf } from '../utils/pdfGenerator';
import { WASTE_LEVEL_META } from '../utils/wasteTokens';

interface RecordsTabProps {
  records: WasteRecord[];
  students: Student[];
  onRecordsChange: (records: WasteRecord[]) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

export const RecordsTab: React.FC<RecordsTabProps> = ({
  records,
  students,
  onRecordsChange,
  showToast,
}) => {
  // Filters
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'all' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [sessionFilter, setSessionFilter] = useState<string>('All');
  const [hostelFilter, setHostelFilter] = useState<string>('All');
  const [wasteFilter, setWasteFilter] = useState<string>('All');
  const [isFilterExpanded, setIsFilterExpanded] = useState<boolean>(false);

  // Full-photo viewer modal with pinch/zoom
  const [viewingRecord, setViewingRecord] = useState<WasteRecord | null>(null);
  const [photoZoom, setPhotoZoom] = useState<number>(1);

  // Edit record modal
  const [editingRecord, setEditingRecord] = useState<WasteRecord | null>(null);
  const [editWasteLevel, setEditWasteLevel] = useState<WasteLevel>('Medium');
  const [editStudentGr, setEditStudentGr] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete single record modal
  const [recordToDelete, setRecordToDelete] = useState<WasteRecord | null>(null);

  // 90-day cleanup modal
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // Date helpers
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Filter records
  const filteredRecords = records.filter((r) => {
    const recordDateStr = r.timestamp ? r.timestamp.split('T')[0] : '';

    if (dateFilter === 'today' && recordDateStr !== todayStr) return false;
    if (dateFilter === 'yesterday' && recordDateStr !== yesterdayStr) return false;
    if (dateFilter === 'custom' && recordDateStr !== customDate) return false;

    if (sessionFilter !== 'All' && r.session !== sessionFilter) return false;
    if (hostelFilter !== 'All' && r.hostel !== hostelFilter) return false;
    if (wasteFilter !== 'All' && r.wasteLevel !== wasteFilter) return false;

    return true;
  });

  // Calculate Stat Cards (Today's statistics)
  const todayRecords = records.filter(
    (r) => r.timestamp && r.timestamp.split('T')[0] === todayStr
  );
  const totalScannedToday = todayRecords.length;
  const totalWastedToday = todayRecords.filter(
    (r) => r.wasteLevel === 'Medium' || r.wasteLevel === 'High'
  ).length;

  // Calculate worst hostel today (highest waste count)
  const wasteCountByHostel: Record<string, number> = {};
  todayRecords.forEach((r) => {
    if (r.wasteLevel === 'Medium' || r.wasteLevel === 'High') {
      wasteCountByHostel[r.hostel] = (wasteCountByHostel[r.hostel] || 0) + 1;
    }
  });

  let worstHostel = 'None';
  let maxWaste = 0;
  Object.entries(wasteCountByHostel).forEach(([h, count]) => {
    if (count > maxWaste) {
      maxWaste = count;
      worstHostel = `Hostel ${h} (${count})`;
    }
  });

  // Toggle "Verified by manager"
  const toggleVerified = async (record: WasteRecord) => {
    try {
      const updatedVerified = !record.isVerified;
      if (db) {
        await updateDoc(doc(db, 'waste_records', record.id), {
          isVerified: updatedVerified,
        });
      }
      const updated = records.map((r) =>
        r.id === record.id ? { ...r, isVerified: updatedVerified } : r
      );
      onRecordsChange(updated);
      showToast(
        updatedVerified ? 'Record marked as verified!' : 'Verification removed.',
        'info'
      );
    } catch (err) {
      console.error('Error toggling verified:', err);
      handleFirestoreError(err, OperationType.UPDATE, `waste_records/${record.id}`);
      showToast('Failed to update verification status.', 'error');
    }
  };

  // Open Edit Record
  const openEdit = (record: WasteRecord) => {
    setEditingRecord(record);
    setEditWasteLevel(record.wasteLevel);
    setEditStudentGr(record.studentGr);
    setEditReason(record.reason || '');
  };

  // Save Edit Record
  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    try {
      setIsUpdating(true);
      const studentMatch = students.find((s) => s.gr === editStudentGr);

      const updates: Partial<WasteRecord> = {
        wasteLevel: editWasteLevel,
        reason: editReason.trim(),
        studentGr: editStudentGr,
        studentName: studentMatch ? studentMatch.name : editingRecord.studentName,
        hostel: studentMatch ? studentMatch.hostel : editingRecord.hostel,
      };

      if (db) {
        await updateDoc(doc(db, 'waste_records', editingRecord.id), updates);
      }

      const updated = records.map((r) =>
        r.id === editingRecord.id ? { ...r, ...updates } : r
      );
      onRecordsChange(updated);
      showToast('Record updated successfully!', 'success');
      setEditingRecord(null);
    } catch (err) {
      console.error('Error updating record:', err);
      handleFirestoreError(err, OperationType.UPDATE, `waste_records/${editingRecord.id}`);
      showToast('Failed to update record.', 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  // Delete Single Record
  const confirmDeleteRecord = async () => {
    if (!recordToDelete) return;
    try {
      if (db) {
        await deleteDoc(doc(db, 'waste_records', recordToDelete.id));
      }
      const updated = records.filter((r) => r.id !== recordToDelete.id);
      onRecordsChange(updated);
      showToast('Record deleted.', 'info');
      setRecordToDelete(null);
    } catch (err) {
      console.error('Error deleting record:', err);
      handleFirestoreError(err, OperationType.DELETE, `waste_records/${recordToDelete.id}`);
      showToast('Failed to delete record.', 'error');
    }
  };

  // 90-Day Privacy Cleanup
  const recordsOlderThan90Days = records.filter((r) => {
    if (!r.timestamp) return false;
    const recordTime = new Date(r.timestamp).getTime();
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return recordTime < ninetyDaysAgo;
  });

  const handleCleanUpOldRecords = async () => {
    try {
      setIsCleaningUp(true);
      for (const rec of recordsOlderThan90Days) {
        if (db) {
          await deleteDoc(doc(db, 'waste_records', rec.id));
        }
      }
      const remaining = records.filter(
        (r) => !recordsOlderThan90Days.some((old) => old.id === r.id)
      );
      onRecordsChange(remaining);
      showToast(`Cleaned up ${recordsOlderThan90Days.length} records older than 90 days.`, 'success');
      setShowCleanupModal(false);
    } catch (err) {
      console.error('Error cleaning up records:', err);
      showToast('Failed to clean up old records.', 'error');
    } finally {
      setIsCleaningUp(false);
    }
  };

  // Requirement 3: Download official Student Warning & Evidence PDF
  const handleDownloadWarningPdf = async (record: WasteRecord) => {
    try {
      showToast('Generating warning evidence PDF...', 'info');
      const { blob, fileName } = await generateWarningEvidencePdf(record);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Warning evidence PDF downloaded!', 'success');
    } catch (err: any) {
      console.error('Failed generating warning PDF:', err);
      showToast('Failed to generate warning evidence PDF.', 'error');
    }
  };

  const getWasteBadgeColor = (level: WasteLevel) => {
    switch (level) {
      case 'None':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'Low':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Medium':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
      case 'High':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    }
  };

  return (
    <div className="space-y-4 pb-2">
      {/* Top Stat Cards with Icons and Trend Arrows (Requirement 9) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Stat 1: Scanned Today */}
        <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/60 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-semibold tracking-wide uppercase">
              Scanned Today
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <UtensilsCrossed className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {totalScannedToday}
            </span>
            <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <TrendingUp className="w-3 h-3" />
              <span>Active</span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 font-medium mt-1">
            Mess counter entries today
          </span>
        </div>

        {/* Stat 2: Wasted Today (Medium + High) */}
        <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/60 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-semibold tracking-wide uppercase">
              Wasted Today
            </span>
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-extrabold text-orange-400 tracking-tight">
              {totalWastedToday}
            </span>
            <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <TrendingDown className="w-3 h-3" />
              <span>
                {totalScannedToday > 0
                  ? `${Math.round((totalWastedToday / totalScannedToday) * 100)}%`
                  : '0%'}
              </span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 font-medium mt-1">
            Medium & High waste incidents
          </span>
        </div>

        {/* Stat 3: Worst Hostel */}
        <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/60 shadow-lg relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-semibold tracking-wide uppercase">
              Highest Wastage Block
            </span>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-extrabold text-rose-400 tracking-tight truncate">
              {worstHostel}
            </span>
            <div className="flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
              <span>Attention</span>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 font-medium mt-1">
            Needs warden supervision
          </span>
        </div>
      </div>

      {/* Collapsible Filter Bar (Requirement 9) */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-700/60 shadow-lg overflow-hidden transition-all">
        {/* Collapsible Header */}
        <div className="p-3 sm:p-3.5 flex items-center justify-between gap-2 border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
            className="flex items-center gap-2 text-xs font-bold text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <span>Filter Records</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              {dateFilter} • {sessionFilter} • {hostelFilter} • {wasteFilter}
            </span>
            {isFilterExpanded ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          <div className="flex items-center gap-2">
            {/* Quick Privacy Clean Up Button */}
            <button
              onClick={() => setShowCleanupModal(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Clean up old records for privacy"
            >
              <Shield className="w-3.5 h-3.5 text-teal-400" />
              <span className="hidden sm:inline">Cleanup &gt;90d</span>
            </button>
          </div>
        </div>

        {/* Collapsible Content */}
        {isFilterExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3.5 space-y-3 bg-slate-950/40"
          >
            {/* Date presets */}
            <div>
              <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                Date Preset
              </label>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs flex-wrap">
                {(['today', 'yesterday', 'all', 'custom'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDateFilter(d)}
                    className={`px-3 py-1.5 rounded-lg font-semibold capitalize transition-all cursor-pointer ${
                      dateFilter === d
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom date picker */}
            {dateFilter === 'custom' && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-slate-400 font-medium">Select Date:</span>
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            {/* Sub-filters: Session, Hostel, Waste Level */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                  Meal Session
                </label>
                <select
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="All">All Sessions</option>
                  <option value="Breakfast">Breakfast</option>
                  <option value="Lunch">Lunch</option>
                  <option value="Dinner">Dinner</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                  Hostel Block
                </label>
                <select
                  value={hostelFilter}
                  onChange={(e) => setHostelFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="All">All Hostels</option>
                  <option value="A">Hostel A</option>
                  <option value="B">Hostel B</option>
                  <option value="C">Hostel C</option>
                  <option value="D">Hostel D</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                  Waste Level
                </label>
                <select
                  value={wasteFilter}
                  onChange={(e) => setWasteFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="All">All Levels</option>
                  <option value="None">None (Clean)</option>
                  <option value="Low">Low (&lt;10%)</option>
                  <option value="Medium">Medium (10–40%)</option>
                  <option value="High">High (&gt;40%)</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Record Photo Cards Timeline List (Requirement 9) */}
      <div className="relative pl-4 sm:pl-6 space-y-4 before:absolute before:left-2 sm:before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
        {filteredRecords.length === 0 ? (
          <div className="p-10 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-xs">
            <Flame className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="font-semibold text-slate-300">No records found</p>
            <p className="mt-1">Try adjusting the date, session, or hostel filters.</p>
          </div>
        ) : (
          filteredRecords.map((record) => {
            const timeDate = new Date(record.timestamp);
            const timeFormatted = !isNaN(timeDate.getTime())
              ? timeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
            const dateFormatted = !isNaN(timeDate.getTime())
              ? timeDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
              : '';
            const wasteMeta = WASTE_LEVEL_META[record.wasteLevel];
            const WasteIcon = wasteMeta.icon;

            return (
              <div
                key={record.id}
                className="relative bg-slate-900/90 rounded-2xl p-3.5 border border-slate-800 shadow-md flex items-center gap-3 transition-all hover:border-slate-700"
              >
                {/* Timeline Node Marker */}
                <span className="absolute -left-[1.35rem] sm:-left-[1.6rem] top-6 w-3 h-3 rounded-full bg-slate-900 border-2 border-emerald-500 shadow-sm" />

                {/* Photo Thumbnail (Click to enlarge full photo) */}
                <div
                  onClick={() => {
                    setViewingRecord(record);
                    setPhotoZoom(1);
                  }}
                  className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border border-slate-700 shrink-0 cursor-pointer group"
                  title="Tap to enlarge photo"
                >
                  <img
                    src={record.photoUrl}
                    alt="Plate and Face"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Eye className="w-5 h-5 text-white" />
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-xs sm:text-sm font-extrabold text-slate-100 truncate">
                      {record.studentName}
                    </h4>
                    {/* Fixed Waste Color Badge with Icon */}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 shrink-0 ${wasteMeta.badgeClassDark}`}
                    >
                      <WasteIcon className="w-2.5 h-2.5" />
                      <span>{wasteMeta.label}</span>
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    GR: <span className="text-slate-300 font-bold">{record.studentGr}</span> • H-{record.hostel} • {record.session}
                  </p>

                  <div className="flex items-center gap-2.5 mt-1.5 text-[10px] text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {dateFormatted} {timeFormatted}
                    </span>

                    {/* Manager Verified Checkbox */}
                    <button
                      type="button"
                      onClick={() => toggleVerified(record)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold transition-colors cursor-pointer ${
                        record.isVerified
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                      }`}
                      title="Toggle Manager Verification"
                    >
                      <CheckCircle2
                        className={`w-3 h-3 ${
                          record.isVerified ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      <span>{record.isVerified ? 'Verified' : 'Verify'}</span>
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDownloadWarningPdf(record)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-teal-950/70 text-slate-400 hover:text-teal-400 transition-colors cursor-pointer"
                    title="Download Warning Evidence PDF"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(record)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                    title="Edit Record"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setRecordToDelete(record)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete Record"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {/* FULL-SCREEN PHOTO PREVIEW MODAL WITH PINCH-TO-ZOOM (Requirement 9) */}
      <AnimatePresence>
        {viewingRecord && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-100">
                    {viewingRecord.studentName} ({viewingRecord.studentGr})
                  </h4>
                  <p className="text-xs text-slate-400">
                    Hostel {viewingRecord.hostel} • {viewingRecord.session} Session
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Zoom controls */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 mr-1">
                    <button
                      type="button"
                      onClick={() => setPhotoZoom((z) => Math.max(1, z - 0.25))}
                      className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-mono text-slate-400 px-1">
                      {Math.round(photoZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setPhotoZoom((z) => Math.min(3, z + 0.25))}
                      className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    {photoZoom > 1 && (
                      <button
                        type="button"
                        onClick={() => setPhotoZoom(1)}
                        className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                        title="Reset Zoom"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setViewingRecord(null)}
                    className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* High-res Image Preview with Zoom Scale */}
              <div className="p-2 bg-black flex items-center justify-center max-h-[60vh] overflow-hidden select-none relative">
                <div
                  className="transition-transform duration-200 cursor-grab active:cursor-grabbing flex items-center justify-center"
                  style={{ transform: `scale(${photoZoom})` }}
                  onDoubleClick={() => setPhotoZoom((z) => (z > 1 ? 1 : 2))}
                >
                  <img
                    src={viewingRecord.photoUrl}
                    alt="Student face and plate evidence"
                    className="max-h-[56vh] w-auto object-contain rounded-xl shadow-lg pointer-events-none"
                  />
                </div>
                {photoZoom === 1 && (
                  <span className="absolute bottom-3 text-[10px] text-white/60 bg-black/50 px-2 py-0.5 rounded-full pointer-events-none">
                    Double-tap or use buttons to zoom
                  </span>
                )}
              </div>

              <div className="p-4 space-y-2.5 bg-slate-900 border-t border-slate-800">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                        WASTE_LEVEL_META[viewingRecord.wasteLevel].badgeClassDark
                      }`}
                    >
                      Waste Level: {viewingRecord.wasteLevel}
                    </span>
                    {viewingRecord.isVerified && (
                      <span className="text-xs text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    {new Date(viewingRecord.timestamp).toLocaleString()}
                  </span>
                </div>

                {viewingRecord.reason && (
                  <p className="text-xs text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800 italic">
                    "{viewingRecord.reason}"
                  </p>
                )}

                {/* Download Warning Evidence PDF Button */}
                <div className="pt-1 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleDownloadWarningPdf(viewingRecord)}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-bold shadow-md flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Download Warning Evidence PDF</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT RECORD MODAL */}
      <AnimatePresence>
        {editingRecord && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-emerald-400" />
                  Edit Waste Record
                </h3>
                <button
                  onClick={() => setEditingRecord(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Change Student GR */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Assigned Student:
                </label>
                <select
                  value={editStudentGr}
                  onChange={(e) => setEditStudentGr(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  {students.map((s) => (
                    <option key={s.gr} value={s.gr}>
                      {s.name} ({s.gr}) - Hostel {s.hostel}
                    </option>
                  ))}
                </select>
              </div>

              {/* Change Waste Level */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Waste Level:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['None', 'Low', 'Medium', 'High'] as WasteLevel[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setEditWasteLevel(lvl)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                        editWasteLevel === lvl
                          ? 'bg-emerald-600 text-white border-emerald-400 shadow-md ring-2 ring-emerald-400'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change Reason Note */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">
                  Leftover Note:
                </label>
                <input
                  type="text"
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isUpdating}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5"
                >
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE SINGLE RECORD MODAL */}
      <AnimatePresence>
        {recordToDelete && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-100">Delete Record?</h4>
                  <p className="text-xs text-slate-400">
                    {recordToDelete.studentName} ({recordToDelete.studentGr})
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                This record and evidence photo will be permanently deleted from Firestore.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRecordToDelete(null)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteRecord}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 90-DAY CLEANUP CONFIRMATION MODAL */}
      <AnimatePresence>
        {showCleanupModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-100">
                    Data Privacy Cleanup
                  </h4>
                  <p className="text-xs text-slate-400">
                    Purge student records older than 90 days
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
                Found <strong>{recordsOlderThan90Days.length} records</strong> older than 90 days in Firestore.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowCleanupModal(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCleanUpOldRecords}
                  disabled={recordsOlderThan90Days.length === 0 || isCleaningUp}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md disabled:opacity-50"
                >
                  {isCleaningUp ? 'Purging...' : 'Purge Old Data'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
