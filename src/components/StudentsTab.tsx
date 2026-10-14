import React, { useState, useRef } from 'react';
import {
  UserPlus,
  Search,
  Upload,
  Download,
  Trash2,
  Edit2,
  Camera,
  AlertTriangle,
  Check,
  X,
  FileSpreadsheet,
  Users,
  Image as ImageIcon,
  RotateCcw,
  Smartphone,
  RefreshCw,
  QrCode,
  Printer,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Student, HostelType } from '../types';
import { compressImage } from '../utils/imageUtils';
import { generateAllStudentsQrPdf } from '../utils/qrUtils';
import { detectLargestFaceDescriptor } from '../utils/faceRecognition';
import { StudentQrCardModal } from './StudentQrCardModal';
import { CameraCapture } from './CameraCapture';

interface StudentsTabProps {
  students: Student[];
  onStudentsChange: (students: Student[]) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'error') => void;
}

export const StudentsTab: React.FC<StudentsTabProps> = ({
  students,
  onStudentsChange,
  showToast,
}) => {
  // Search and filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHostel, setSelectedHostel] = useState<string>('All');

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [regStep, setRegStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState<{
    gr: string;
    name: string;
    hostel: HostelType;
    photoUrl: string;
    phone?: string;
    faceDescriptor?: number[];
  }>({
    gr: '',
    name: '',
    hostel: 'A',
    photoUrl: '',
    phone: '',
    faceDescriptor: undefined,
  });

  // Modal camera capture toggle state & photo processing state
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Re-compute face data state
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [recomputeProgress, setRecomputeProgress] = useState<string>('');

  // Delete confirmation
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);

  // Student QR Pass modal
  const [qrCardStudent, setQrCardStudent] = useState<Student | null>(null);
  const [isGeneratingAllQr, setIsGeneratingAllQr] = useState<boolean>(false);

  // Bulk import state
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkParsedStudents, setBulkParsedStudents] = useState<Student[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Download all printable QR Cards as A4 PDF
  const handleDownloadAllQrPdf = async () => {
    if (students.length === 0) {
      showToast('No students registered to generate QR cards.', 'error');
      return;
    }
    try {
      setIsGeneratingAllQr(true);
      showToast('Generating 8-per-page printable QR cards PDF...', 'info');
      const { blob, fileName } = await generateAllStudentsQrPdf(
        students,
        selectedHostel
      );

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

      showToast(`QR Cards PDF downloaded: ${fileName}`, 'success');
    } catch (err: any) {
      console.error('Error generating QR Cards PDF:', err);
      showToast(`Failed to generate QR cards PDF: ${err?.message || err}`, 'error');
    } finally {
      setIsGeneratingAllQr(false);
    }
  };

  // Filtered students
  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.gr.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesHostel =
      selectedHostel === 'All' ? true : s.hostel === selectedHostel;
    return matchesSearch && matchesHostel;
  });

  // Hostel counts
  const hostelList: HostelType[] = ['A', 'B', 'C', 'D', 'Other'];
  const countByHostel = hostelList.reduce((acc, h) => {
    acc[h] = students.filter((s) => s.hostel === h).length;
    return acc;
  }, {} as Record<HostelType, number>);

  const missingPhotoCount = students.filter((s) => !s.photoUrl).length;

  // Open Add student modal (Step-by-step registration: 1. Photo -> 2. Details -> 3. Confirm)
  const openAddModal = () => {
    setEditingStudent(null);
    setRegStep(1);
    setFormData({
      gr: '',
      name: '',
      hostel: 'A',
      photoUrl: '',
      phone: '',
      faceDescriptor: undefined,
    });
    setIsCapturingPhoto(false);
    setIsProcessingPhoto(false);
    setIsModalOpen(true);
  };

  // Open Edit modal
  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setRegStep(2); // Start on details for editing
    setFormData({
      gr: student.gr,
      name: student.name,
      hostel: student.hostel,
      photoUrl: student.photoUrl || '',
      phone: student.phone || '',
      faceDescriptor: student.faceDescriptor,
    });
    setIsCapturingPhoto(false);
    setIsProcessingPhoto(false);
    setIsModalOpen(true);
  };

  /**
   * Requirement 2: Detect face in reference photo, compute 128-number descriptor.
   * If no face is found, reject the photo with:
   * "No clear face found, please retake in good light, looking straight"
   */
  const processAndValidateFacePhoto = async (photoBase64: string): Promise<boolean> => {
    setIsProcessingPhoto(true);
    try {
      showToast('Detecting face & computing 128-d descriptor...', 'info');
      const result = await detectLargestFaceDescriptor(photoBase64);

      if (!result || !result.descriptor || result.descriptor.length !== 128) {
        showToast('No clear face found, please retake in good light, looking straight', 'error');
        setFormData((prev) => ({
          ...prev,
          photoUrl: '',
          faceDescriptor: undefined,
        }));
        return false;
      }

      setFormData((prev) => ({
        ...prev,
        photoUrl: photoBase64,
        faceDescriptor: result.descriptor,
      }));

      if (result.allFacesCount > 1) {
        showToast('Face recognized (multiple faces detected; largest face selected)!', 'success');
      } else {
        showToast('Face recognized & 128-d descriptor computed!', 'success');
      }
      return true;
    } catch (err: any) {
      console.error('Face validation error:', err);
      showToast('No clear face found, please retake in good light, looking straight', 'error');
      setFormData((prev) => ({
        ...prev,
        photoUrl: '',
        faceDescriptor: undefined,
      }));
      return false;
    } finally {
      setIsProcessingPhoto(false);
      setIsCapturingPhoto(false);
    }
  };

  // Save student (Add or Edit) - Direct base64 and 128-number faceDescriptor in Firestore
  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const grTrimmed = formData.gr.trim().toUpperCase();
    const nameTrimmed = formData.name.trim();

    if (!grTrimmed || !nameTrimmed) {
      showToast('GR Number and Student Name are required.', 'error');
      return;
    }

    // Unique GR check on create
    if (!editingStudent && students.some((s) => s.gr.toUpperCase() === grTrimmed)) {
      showToast(`Student with GR '${grTrimmed}' already exists.`, 'error');
      return;
    }

    try {
      setIsSaving(true);
      let finalDescriptor = formData.faceDescriptor;

      // Requirement 2: If a photo is attached but descriptor not computed yet, compute it now
      if (formData.photoUrl && (!finalDescriptor || finalDescriptor.length !== 128)) {
        showToast('Validating face in photo before saving...', 'info');
        const faceResult = await detectLargestFaceDescriptor(formData.photoUrl);
        if (!faceResult || !faceResult.descriptor || faceResult.descriptor.length !== 128) {
          showToast('No clear face found, please retake in good light, looking straight', 'error');
          setIsSaving(false);
          return;
        }
        finalDescriptor = faceResult.descriptor;
      }

      const updatedStudent: Student = {
        gr: grTrimmed,
        name: nameTrimmed,
        hostel: formData.hostel,
        photoUrl: formData.photoUrl || undefined,
        hasPhoto: Boolean(formData.photoUrl),
        phone: formData.phone?.trim() || undefined,
        faceDescriptor: finalDescriptor || undefined,
        updatedAt: new Date().toISOString(),
      };

      if (db) {
        await setDoc(doc(db, 'students', grTrimmed), updatedStudent);
      }

      let newStudentsList: Student[];
      if (editingStudent) {
        newStudentsList = students.map((s) =>
          s.gr === editingStudent.gr ? updatedStudent : s
        );
      } else {
        newStudentsList = [...students, updatedStudent];
      }
      onStudentsChange(newStudentsList);

      showToast(`Student ${nameTrimmed} saved with face recognition data!`, 'success');
      setIsCapturingPhoto(false);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving student:', err);
      handleFirestoreError(err, OperationType.WRITE, 'students');
      showToast('Failed to save student.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Requirement 2: Students who have reference photos but no 128-number face descriptor
  const studentsNeedingDescriptors = students.filter(
    (s) => s.photoUrl && (!s.faceDescriptor || s.faceDescriptor.length !== 128)
  );

  // Batch re-compute face data for all students missing descriptors
  const handleRecomputeAllDescriptors = async () => {
    if (studentsNeedingDescriptors.length === 0) {
      showToast('All students with photos already have face descriptors.', 'info');
      return;
    }

    setIsRecomputing(true);
    setRecomputeProgress(`Processing 0 / ${studentsNeedingDescriptors.length}...`);
    try {
      let successCount = 0;
      let failedCount = 0;
      const updatedMap = new Map<string, number[]>();

      for (let i = 0; i < studentsNeedingDescriptors.length; i++) {
        const student = studentsNeedingDescriptors[i];
        setRecomputeProgress(`Processing ${i + 1} / ${studentsNeedingDescriptors.length}: ${student.name}...`);
        try {
          const result = await detectLargestFaceDescriptor(student.photoUrl!);
          if (result && result.descriptor && result.descriptor.length === 128) {
            updatedMap.set(student.gr, result.descriptor);
            if (db) {
              await setDoc(
                doc(db, 'students', student.gr),
                {
                  ...student,
                  faceDescriptor: result.descriptor,
                  updatedAt: new Date().toISOString(),
                },
                { merge: true }
              );
            }
            successCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
      }

      if (updatedMap.size > 0) {
        const updatedList = students.map((s) => {
          const desc = updatedMap.get(s.gr);
          return desc ? { ...s, faceDescriptor: desc } : s;
        });
        onStudentsChange(updatedList);
      }

      showToast(
        `Re-computed: ${successCount} updated${failedCount > 0 ? `, ${failedCount} photos had no clear face.` : '.'}`,
        successCount > 0 ? 'success' : 'error'
      );
    } catch (err: any) {
      showToast(`Re-compute failed: ${err?.message || err}`, 'error');
    } finally {
      setIsRecomputing(false);
      setRecomputeProgress('');
    }
  };

  // Single student re-compute face data
  const handleRecomputeSingleStudent = async (student: Student) => {
    if (!student.photoUrl) {
      showToast('Student has no photo to compute face data from.', 'error');
      return;
    }

    try {
      showToast(`Detecting face for ${student.name}...`, 'info');
      const result = await detectLargestFaceDescriptor(student.photoUrl);
      if (!result || !result.descriptor || result.descriptor.length !== 128) {
        showToast('No clear face found, please retake in good light, looking straight', 'error');
        return;
      }

      const updated = {
        ...student,
        faceDescriptor: result.descriptor,
        updatedAt: new Date().toISOString(),
      };

      if (db) {
        await setDoc(doc(db, 'students', student.gr), updated);
      }

      const updatedList = students.map((s) => (s.gr === student.gr ? updated : s));
      onStudentsChange(updatedList);
      showToast(`Face data computed successfully for ${student.name}!`, 'success');
    } catch (err: any) {
      showToast(`Failed to compute face data: ${err?.message || err}`, 'error');
    }
  };

  // Delete student
  const confirmDeleteStudent = async () => {
    if (!studentToDelete) return;
    try {
      if (db) {
        await deleteDoc(doc(db, 'students', studentToDelete.gr));
      }
      const updated = students.filter((s) => s.gr !== studentToDelete.gr);
      onStudentsChange(updated);
      showToast(`Student ${studentToDelete.name} deleted.`, 'info');
      setStudentToDelete(null);
    } catch (err) {
      console.error('Error deleting student:', err);
      handleFirestoreError(err, OperationType.DELETE, `students/${studentToDelete.gr}`);
      showToast('Failed to delete student.', 'error');
    }
  };

  // Download sample CSV template
  const downloadSampleTemplate = () => {
    const sampleData = [
      { GR: 'GR201', Name: 'Aarav Patel', Hostel: 'A' },
      { GR: 'GR202', Name: 'Rohan Sharma', Hostel: 'B' },
      { GR: 'GR203', Name: 'Vikram Singh', Hostel: 'C' },
      { GR: 'GR204', Name: 'Kavya Nair', Hostel: 'D' },
      { GR: 'GR205', Name: 'Pooja Reddy', Hostel: 'Other' },
    ];
    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_students_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Bulk File Upload handler (Excel / CSV)
  const handleBulkFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (fileExt === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processRawRows(results.data);
        },
        error: () => {
          showToast('Failed to parse CSV file.', 'error');
        },
      });
    } else if (fileExt === 'xlsx' || fileExt === 'xls') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
          processRawRows(rawRows);
        } catch (err) {
          showToast('Failed to parse Excel file.', 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      showToast('Please upload a .csv or .xlsx file.', 'error');
    }
  };

  const processRawRows = (rows: any[]) => {
    const parsedList: Student[] = [];
    rows.forEach((row) => {
      // Look for keys case-insensitively
      const gr = (row.GR || row.gr || row.Gr || row['GR Number'] || row['Roll No'])?.toString().trim().toUpperCase();
      const name = (row.Name || row.name || row['Student Name'] || row.FullName)?.toString().trim();
      let hostelRaw = (row.Hostel || row.hostel || row.Block || 'Other')?.toString().trim().toUpperCase();

      if (!hostelList.includes(hostelRaw as any)) {
        hostelRaw = 'Other';
      }

      if (gr && name) {
        parsedList.push({
          gr,
          name,
          hostel: hostelRaw as HostelType,
          hasPhoto: false,
        });
      }
    });

    if (parsedList.length === 0) {
      showToast('No valid student rows found. Expected columns: GR, Name, Hostel.', 'error');
      return;
    }

    setBulkParsedStudents(parsedList);
    setIsBulkModalOpen(true);
  };

  // Commit bulk import to Firestore
  const handleCommitBulkImport = async () => {
    if (bulkParsedStudents.length === 0) return;
    try {
      setIsImporting(true);
      const studentMap = new Map<string, Student>();
      students.forEach((s) => studentMap.set(s.gr, s));

      for (const st of bulkParsedStudents) {
        const existing = studentMap.get(st.gr);
        const merged: Student = {
          ...st,
          photoUrl: existing?.photoUrl,
          hasPhoto: Boolean(existing?.photoUrl),
          updatedAt: new Date().toISOString(),
        };
        studentMap.set(st.gr, merged);
        if (db) {
          await setDoc(doc(db, 'students', st.gr), merged);
        }
      }

      const updatedList = Array.from(studentMap.values());
      onStudentsChange(updatedList);
      showToast(`Imported ${bulkParsedStudents.length} students successfully!`, 'success');
      setIsBulkModalOpen(false);
      setBulkParsedStudents([]);
    } catch (err) {
      console.error('Bulk import error:', err);
      handleFirestoreError(err, OperationType.WRITE, 'students');
      showToast('Error during bulk import.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4 pb-2">
      {/* Top Header Card with Stats & Actions */}
      <div className="bg-slate-900/90 rounded-2xl p-4 border border-slate-700/60 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Student Directory ({students.length})
              </h2>
              <p className="text-xs text-slate-400">
                Hostel mess registered residents
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Download all QR cards as PDF Button */}
            <button
              onClick={handleDownloadAllQrPdf}
              disabled={isGeneratingAllQr || students.length === 0}
              className="px-3 py-2 rounded-xl bg-teal-900/40 hover:bg-teal-900/70 border border-teal-500/40 text-xs font-semibold text-teal-300 hover:text-teal-200 flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={`Download printable A4 PDF (8 cards/sheet) for ${selectedHostel === 'All' ? 'all hostels' : `Hostel ${selectedHostel}`}`}
            >
              {isGeneratingAllQr ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                  <span>Building PDF...</span>
                </>
              ) : (
                <>
                  <Printer className="w-3.5 h-3.5 text-teal-400" />
                  <span>Download all QR cards (PDF)</span>
                </>
              )}
            </button>

            {/* Bulk Import Button */}
            <label className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
              <span>Import Excel/CSV</span>
              <input
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleBulkFileUpload}
                className="hidden"
              />
            </label>

            {/* Add Student Button */}
            <button
              onClick={openAddModal}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 text-xs font-semibold text-white shadow-md flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Student</span>
            </button>
          </div>
        </div>

        {/* Warning Banner for Missing Photos */}
        {missingPhotoCount > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>{missingPhotoCount} students</strong> have no reference face photo.
              </span>
            </div>
            <button
              onClick={downloadSampleTemplate}
              className="text-[11px] text-amber-300 hover:text-white underline shrink-0 flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> Template
            </button>
          </div>
        )}

        {/* Requirement 2: Re-compute face data banner for old students with missing descriptors */}
        {studentsNeedingDescriptors.length > 0 && (
          <div className="p-2.5 rounded-xl bg-teal-950/80 border border-teal-500/40 text-teal-200 text-xs flex flex-wrap items-center justify-between gap-2 shadow-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400 shrink-0" />
              <span>
                <strong>{studentsNeedingDescriptors.length} students</strong> have photos without 128-number face recognition data.
              </span>
            </div>
            <button
              type="button"
              onClick={handleRecomputeAllDescriptors}
              disabled={isRecomputing}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:opacity-95 active:scale-95 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecomputing ? 'animate-spin' : ''}`} />
              <span>{isRecomputing ? (recomputeProgress || 'Re-computing...') : `Re-compute face data (${studentsNeedingDescriptors.length})`}</span>
            </button>
          </div>
        )}

        {/* Hostel Count Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs">
          <button
            onClick={() => setSelectedHostel('All')}
            className={`px-3 py-1 rounded-lg font-semibold transition-colors shrink-0 ${
              selectedHostel === 'All'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({students.length})
          </button>
          {hostelList.map((h) => (
            <button
              key={h}
              onClick={() => setSelectedHostel(h)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0 ${
                selectedHostel === h
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Hostel {h} ({countByHostel[h] || 0})
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search students by Name or GR number..."
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Student Cards Responsive Grid (1 col on phone, 2 on tablet, 3 on desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredStudents.length === 0 ? (
          <div className="col-span-full p-8 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-xs">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="font-semibold text-slate-300">No students found</p>
            <p className="mt-1">Add a new student or import an Excel/CSV roster.</p>
          </div>
        ) : (
          filteredStudents.map((student) => {
            const hasFaceData = Boolean(
              student.faceDescriptor && student.faceDescriptor.length === 128
            );
            const hasPhone = Boolean(student.phone && student.phone.trim().length > 0);

            return (
              <div
                key={student.gr}
                className="bg-slate-900/90 rounded-2xl p-3.5 border border-slate-800 shadow-lg flex flex-col justify-between gap-3 transition-all hover:border-slate-700/80"
              >
                <div className="flex items-start gap-3">
                  {/* Photo thumbnail */}
                  {student.photoUrl ? (
                    <img
                      src={student.photoUrl}
                      alt={student.name}
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-slate-700/80 shadow-md shrink-0"
                    />
                  ) : (
                    <div
                      onClick={() => openEditModal(student)}
                      className="w-14 h-14 rounded-2xl bg-amber-950/40 border-2 border-dashed border-amber-500/50 flex flex-col items-center justify-center shrink-0 cursor-pointer text-amber-400 hover:bg-amber-900/40 transition-colors"
                      title="Tap to snap photo"
                    >
                      <Camera className="w-5 h-5 mb-0.5" />
                      <span className="text-[9px] font-bold">No Face</span>
                    </div>
                  )}

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className="text-sm font-extrabold text-slate-100 truncate">
                        {student.name}
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-teal-300 border border-slate-700 shrink-0">
                        H-{student.hostel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      GR: <span className="text-slate-300 font-semibold">{student.gr}</span>
                    </p>

                    {/* Status Badges: 'QR ready', 'Face data ready', 'Phone added' */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {/* QR Ready Badge */}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <QrCode className="w-2.5 h-2.5 text-emerald-400" />
                        <span>QR ready</span>
                      </span>

                      {/* Face Data Status Badge */}
                      {hasFaceData ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/10 text-teal-300 border border-teal-500/30 flex items-center gap-1 shrink-0">
                          <Sparkles className="w-2.5 h-2.5 text-teal-400" />
                          <span>Face ready</span>
                        </span>
                      ) : student.photoUrl ? (
                        <button
                          type="button"
                          onClick={() => handleRecomputeSingleStudent(student)}
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0 hover:bg-amber-500/20 cursor-pointer"
                          title="Click to compute face recognition data"
                        >
                          <RefreshCw className="w-2.5 h-2.5 text-amber-400" />
                          <span>Needs face data</span>
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 shrink-0">
                          <Camera className="w-2.5 h-2.5 text-slate-500" />
                          <span>No photo</span>
                        </span>
                      )}

                      {/* Phone Added Badge */}
                      {hasPhone ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 flex items-center gap-1 shrink-0">
                          <Smartphone className="w-2.5 h-2.5 text-sky-400" />
                          <span>Phone added</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/80 text-slate-500 border border-slate-800 flex items-center gap-1 shrink-0">
                          <Smartphone className="w-2.5 h-2.5 opacity-50" />
                          <span>No phone</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Bottom Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                  <span className="text-[11px] text-slate-500 font-medium">
                    {student.phone ? `Ph: ${student.phone}` : 'Mess Counter Pass'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQrCardStudent(student)}
                      className="px-2.5 py-1 rounded-xl bg-teal-950/60 hover:bg-teal-900/80 text-teal-300 border border-teal-700/50 transition-colors cursor-pointer flex items-center gap-1 font-semibold text-[11px]"
                      title="View & Download Student QR Pass"
                    >
                      <QrCode className="w-3 h-3 text-teal-400" />
                      <span>QR Pass</span>
                    </button>
                    <button
                      onClick={() => openEditModal(student)}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                      title="Edit Student"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setStudentToDelete(student)}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Delete Student"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Action Button for Adding Student (Requirement 8) */}
      <button
        onClick={openAddModal}
        className="fixed bottom-24 right-5 sm:right-8 z-30 w-14 h-14 rounded-full bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 text-white shadow-2xl shadow-emerald-950 flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 border-2 border-emerald-400/40"
        title="Add / Register New Student"
      >
        <UserPlus className="w-6 h-6 drop-shadow" />
      </button>

      {/* ADD / EDIT MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-emerald-400" />
                  {editingStudent ? 'Edit Student Details' : 'Register New Student'}
                </h3>
                <button
                  onClick={() => {
                    setIsCapturingPhoto(false);
                    setIsModalOpen(false);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Step indicator tabs */}
              <div className="px-5 pt-3 pb-2 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-1 text-xs">
                {[
                  { step: 1, label: '1. Photo' },
                  { step: 2, label: '2. Details' },
                  { step: 3, label: '3. Confirm' },
                ].map((s) => (
                  <button
                    key={s.step}
                    type="button"
                    onClick={() => setRegStep(s.step as 1 | 2 | 3)}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-center font-bold text-xs transition-all cursor-pointer ${
                      regStep === s.step
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-md'
                        : regStep > s.step
                        ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40'
                        : 'bg-slate-900 text-slate-500 border border-slate-800'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSaveStudent} className="p-5 space-y-4">
                {/* STEP 1: PHOTO */}
                {regStep === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Reference Face Photo:
                      </label>
                      {formData.photoUrl && !isCapturingPhoto && (
                        <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                          ✓ Photo Captured
                        </span>
                      )}
                    </div>

                    {isCapturingPhoto ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-teal-300 flex items-center gap-1.5">
                            <Camera className="w-3.5 h-3.5" /> Live Camera
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsCapturingPhoto(false)}
                            className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                          >
                            Cancel Camera
                          </button>
                        </div>

                        <CameraCapture
                          onCapture={(compressedPhoto) => {
                            processAndValidateFacePhoto(compressedPhoto);
                          }}
                          targetMaxDimension={300}
                          quality={0.6}
                          overlayType="student-face"
                          aspectRatioClass="aspect-square sm:aspect-video"
                          minHeightClass="min-h-[240px]"
                          shutterTitle="Snap Face Photo"
                          showFlipButton={true}
                        />
                      </div>
                    ) : formData.photoUrl ? (
                      <div className="flex items-center gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-2xl">
                        <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-emerald-500/60 shadow-md shrink-0 group">
                          <img
                            src={formData.photoUrl}
                            alt="Student Face Preview"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((p) => ({
                                ...p,
                                photoUrl: '',
                                faceDescriptor: undefined,
                              }))
                            }
                            className="absolute top-1 right-1 p-1 rounded-full bg-slate-900/90 text-rose-400 border border-slate-700 hover:bg-rose-950 cursor-pointer shadow"
                            title="Remove photo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-200">Face photo attached</p>
                          {isProcessingPhoto ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-teal-300">
                              <RefreshCw className="w-3 h-3 animate-spin text-teal-400" />
                              <span>Computing 128-d descriptor...</span>
                            </div>
                          ) : formData.faceDescriptor && formData.faceDescriptor.length === 128 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800">
                              <Sparkles className="w-2.5 h-2.5" /> 128-d Face Descriptor Ready
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800">
                                <AlertTriangle className="w-2.5 h-2.5" /> Missing Descriptor
                              </span>
                              <button
                                type="button"
                                onClick={() => processAndValidateFacePhoto(formData.photoUrl)}
                                className="text-[11px] text-teal-300 hover:text-teal-200 underline flex items-center gap-1 cursor-pointer block"
                              >
                                <RefreshCw className="w-3 h-3 text-teal-400" /> Re-compute face data
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setIsCapturingPhoto(true)}
                              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-teal-300 border border-slate-700 flex items-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>Retake photo</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-center gap-3 p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800">
                        <div className="w-20 h-20 rounded-2xl bg-slate-900 border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 shrink-0">
                          <ImageIcon className="w-7 h-7 mb-0.5 text-slate-600" />
                          <span className="text-[9px]">No Photo</span>
                        </div>
                        <div className="flex-1 space-y-2 w-full text-center sm:text-left">
                          <div>
                            <p className="text-xs font-bold text-slate-200">Face Photo Required</p>
                            <p className="text-[11px] text-slate-400">
                              Snap a front-facing photo or upload from device for face recognition.
                            </p>
                          </div>
                          {isProcessingPhoto ? (
                            <div className="flex items-center gap-2 text-xs text-teal-300 p-2 rounded-xl bg-teal-950/50 border border-teal-800">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
                              <span>Detecting face & computing descriptor...</span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                              <button
                                type="button"
                                onClick={() => setIsCapturingPhoto(true)}
                                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-95 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950"
                              >
                                <Camera className="w-3.5 h-3.5" />
                                <span>Open Live Camera</span>
                              </button>
                              <label className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 cursor-pointer">
                                <Upload className="w-3.5 h-3.5 text-teal-400" />
                                <span>Upload photo</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (f) {
                                      const comp = await compressImage(f, 300, 0.6);
                                      await processAndValidateFacePhoto(comp);
                                    }
                                    e.target.value = '';
                                  }}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setRegStep(2)}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md"
                      >
                        <span>Next: Student Details →</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 2: DETAILS */}
                {regStep === 2 && (
                  <div className="space-y-3.5">
                    {/* GR Number */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        GR Number (Unique ID):
                      </label>
                      <input
                        type="text"
                        required
                        disabled={Boolean(editingStudent)}
                        value={formData.gr}
                        onChange={(e) =>
                          setFormData({ ...formData, gr: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g., GR1052"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 uppercase font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                      />
                    </div>

                    {/* Student Full Name */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Student Full Name:
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Rahul Dev"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    {/* Hostel Selection */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Hostel Block:
                      </label>
                      <div className="grid grid-cols-5 gap-1.5">
                        {hostelList.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setFormData({ ...formData, hostel: h })}
                            className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                              formData.hostel === h
                                ? 'bg-emerald-600 text-white border-emerald-400 shadow-sm'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                            }`}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Phone Number */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-300">
                        Phone Number (optional):
                      </label>
                      <input
                        type="tel"
                        value={formData.phone || ''}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="e.g., +91 98765 43210"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setRegStep(1)}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                      >
                        ← Back to Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegStep(3)}
                        disabled={!formData.gr.trim() || !formData.name.trim()}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
                      >
                        <span>Next: Confirm →</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 3: CONFIRM */}
                {regStep === 3 && (
                  <div className="space-y-4">
                    <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                      <div className="flex items-center gap-3">
                        {formData.photoUrl ? (
                          <img
                            src={formData.photoUrl}
                            alt="Preview"
                            className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/60 shadow"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-2xl bg-slate-900 border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-500">
                            <Users className="w-6 h-6" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="text-base font-extrabold text-white truncate">
                            {formData.name || 'Unnamed Student'}
                          </h4>
                          <p className="text-xs text-slate-400 font-mono">
                            GR: <span className="text-emerald-400 font-bold">{formData.gr || 'N/A'}</span>
                          </p>
                          <p className="text-xs text-slate-400">
                            Hostel Block <span className="text-slate-200 font-semibold">{formData.hostel}</span>
                            {formData.phone ? ` • Ph: ${formData.phone}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-850 text-[11px]">
                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                          <QrCode className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div>
                            <p className="font-bold text-slate-200">QR Pass</p>
                            <p className="text-[10px] text-slate-400">Ready to print</p>
                          </div>
                        </div>

                        <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-teal-400 shrink-0" />
                          <div>
                            <p className="font-bold text-slate-200">Face Recognition</p>
                            <p className="text-[10px] text-slate-400">
                              {formData.faceDescriptor ? '128-d vector ready' : 'Photo optional'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setRegStep(2)}
                        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                      >
                        ← Back to Details
                      </button>

                      {/* Final Submit button */}
                      <button
                        type="submit"
                        disabled={isSaving || !formData.gr.trim() || !formData.name.trim()}
                        className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-500 text-white text-xs font-bold tracking-wide shadow-lg shadow-emerald-900/40 hover:opacity-95 transition-transform active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                      >
                        {isSaving ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Saving Student...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>{editingStudent ? 'Save Changes' : 'Confirm & Register Student'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* BULK IMPORT PREVIEW MODAL */}
      <AnimatePresence>
        {isBulkModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    Review Bulk Import ({bulkParsedStudents.length} Students)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Students will be saved permanently to Firebase.
                  </p>
                </div>
                <button
                  onClick={() => setIsBulkModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-4 space-y-2 flex-1">
                {bulkParsedStudents.slice(0, 50).map((st, idx) => (
                  <div
                    key={st.gr + idx}
                    className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-bold text-slate-200">{st.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">GR: {st.gr}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-teal-300 font-semibold text-[10px]">
                      Hostel {st.hostel}
                    </span>
                  </div>
                ))}
                {bulkParsedStudents.length > 50 && (
                  <p className="text-center text-xs text-slate-500 py-2">
                    ...and {bulkParsedStudents.length - 50} more students.
                  </p>
                )}
              </div>

              <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  onClick={() => setIsBulkModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCommitBulkImport}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md flex items-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm & Import All</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONFIRMATION DIALOG */}
      <AnimatePresence>
        {studentToDelete && (
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
                  <h4 className="text-sm font-bold text-slate-100">Delete Student?</h4>
                  <p className="text-xs text-slate-400">
                    Remove {studentToDelete.name} ({studentToDelete.gr})?
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                This action is permanent and removes the student's reference photo from Firebase.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setStudentToDelete(null)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteStudent}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* STUDENT QR CODE PASS MODAL */}
      <AnimatePresence>
        {qrCardStudent && (
          <StudentQrCardModal
            student={qrCardStudent}
            onClose={() => setQrCardStudent(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
