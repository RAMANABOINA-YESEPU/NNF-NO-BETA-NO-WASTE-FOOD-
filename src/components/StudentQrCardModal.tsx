import React, { useEffect, useState, useRef } from 'react';
import { QrCode, Download, Printer, X, User, Check, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { Student } from '../types';
import { getStudentQrPayload, generateQrCodeDataUrl } from '../utils/qrUtils';

interface StudentQrCardModalProps {
  student: Student;
  onClose: () => void;
}

export const StudentQrCardModal: React.FC<StudentQrCardModalProps> = ({
  student,
  onClose,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoadingQr, setIsLoadingQr] = useState<boolean>(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function makeQr() {
      try {
        const payload = getStudentQrPayload(student.gr);
        const dataUrl = await generateQrCodeDataUrl(payload, 350);
        setQrDataUrl(dataUrl);
      } catch (err) {
        console.warn('QR generation error:', err);
      } finally {
        setIsLoadingQr(false);
      }
    }
    makeQr();
  }, [student.gr]);

  // Download full Student QR Pass Card as high-res PNG image
  const handleDownloadPng = async () => {
    if (!qrDataUrl) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 840;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      // Card Background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 600, 840);

      // Top Teal Header
      ctx.fillStyle = '#0f766e'; // teal-700
      ctx.fillRect(0, 0, 600, 110);

      // Header Text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('NNF MESS ID PASS', 30, 65);

      // Hostel badge
      ctx.fillStyle = '#115e59'; // teal-800
      ctx.beginPath();
      ctx.roundRect(430, 35, 140, 42, 8);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Hostel ${student.hostel}`, 500, 62);

      // Border around card
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 596, 836);

      let currentY = 140;

      // Draw Student Face Photo if present
      if (student.photoUrl) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject();
            img.src = student.photoUrl!;
          });
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(220, currentY, 160, 160, 16);
          ctx.clip();
          ctx.drawImage(img, 220, currentY, 160, 160);
          ctx.restore();
          ctx.strokeStyle = '#0f766e';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.roundRect(220, currentY, 160, 160, 16);
          ctx.stroke();
        } catch {
          // fallback placeholder
          ctx.fillStyle = '#F1F5F9';
          ctx.beginPath();
          ctx.roundRect(220, currentY, 160, 160, 16);
          ctx.fill();
          ctx.fillStyle = '#64748B';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('No Photo', 300, currentY + 90);
        }
      } else {
        ctx.fillStyle = '#F1F5F9';
        ctx.beginPath();
        ctx.roundRect(220, currentY, 160, 160, 16);
        ctx.fill();
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No Photo', 300, currentY + 90);
      }

      currentY += 195;

      // Student Name
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(student.name, 300, currentY);

      currentY += 32;

      // GR Number
      ctx.fillStyle = '#0f766e';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(`GR: ${student.gr}`, 300, currentY);

      currentY += 28;

      // Hostel block info
      ctx.fillStyle = '#64748B';
      ctx.font = 'normal 16px sans-serif';
      ctx.fillText(`Hostel Block ${student.hostel} • Registered Resident`, 300, currentY);

      currentY += 25;

      // Draw QR Code Image
      const qrImg = new Image();
      await new Promise<void>((resolve, reject) => {
        qrImg.onload = () => resolve();
        qrImg.onerror = () => reject();
        qrImg.src = qrDataUrl;
      });

      // QR container box
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.roundRect(175, currentY, 250, 250, 16);
      ctx.fill();
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.drawImage(qrImg, 185, currentY + 10, 230, 230);

      currentY += 275;

      // QR payload text
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(getStudentQrPayload(student.gr), 300, currentY);

      currentY += 26;

      // Bottom note
      ctx.fillStyle = '#94A3B8';
      ctx.font = 'italic 13px sans-serif';
      ctx.fillText('Scan at mess counter before meals', 300, currentY);

      currentY += 22;

      // Founder credit
      ctx.fillStyle = '#0f766e';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('NNF – No Beta No Waste Food · Founded by Yesepu Ramanaboina', 300, currentY);

      const fullDataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = fullDataUrl;
      link.download = `NNF_Pass_${student.gr}_${student.name.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.warn('Canvas export failed, downloading raw QR code:', e);
      const link = document.createElement('a');
      link.href = qrDataUrl;
      link.download = `QR_${student.gr}_${student.name.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Trigger browser print
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
              <QrCode className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100">
              Mess Student QR Pass
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Card Area */}
        <div className="p-5 flex flex-col items-center">
          <div
            ref={cardRef}
            className="w-full bg-white text-slate-900 rounded-2xl p-4 shadow-xl border border-slate-200 relative overflow-hidden flex flex-col items-center text-center"
          >
            {/* Top Teal Ribbon */}
            <div className="w-full bg-teal-700 text-white -mt-4 -mx-4 px-4 py-2.5 mb-3 flex items-center justify-between">
              <span className="text-[11px] font-extrabold tracking-wider">
                NNF MESS ID PASS
              </span>
              <span className="text-[10px] font-bold bg-teal-800/80 px-2 py-0.5 rounded">
                Hostel {student.hostel}
              </span>
            </div>

            {/* Face Photo */}
            <div className="relative mb-2">
              {student.photoUrl ? (
                <img
                  src={student.photoUrl}
                  alt={student.name}
                  className="w-20 h-20 rounded-xl object-cover border-2 border-teal-600 shadow-md"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400">
                  <User className="w-8 h-8 mb-0.5" />
                  <span className="text-[9px]">No Photo</span>
                </div>
              )}
            </div>

            {/* Student Info */}
            <h4 className="text-base font-extrabold text-slate-900 leading-tight">
              {student.name}
            </h4>
            <p className="text-xs font-mono font-bold text-teal-700 mt-0.5">
              GR: {student.gr}
            </p>
            <p className="text-[11px] text-slate-500 font-medium">
              Hostel Block {student.hostel} • Registered Resident
            </p>

            {/* QR Code */}
            <div className="my-3 p-2 bg-slate-50 border border-slate-200 rounded-xl shadow-inner flex flex-col items-center">
              {isLoadingQr ? (
                <div className="w-32 h-32 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <img
                  src={qrDataUrl}
                  alt={`QR for ${student.gr}`}
                  className="w-32 h-32 object-contain"
                />
              )}
              <span className="text-[9px] font-mono font-bold text-slate-500 mt-1 uppercase tracking-wider">
                {getStudentQrPayload(student.gr)}
              </span>
            </div>

            <p className="text-[9px] text-slate-400 flex items-center gap-1 justify-center">
              <ShieldCheck className="w-3 h-3 text-teal-600" />
              Scan at mess counter before meals
            </p>

            <div className="w-full mt-2 pt-1.5 border-t border-slate-100 text-center">
              <p className="text-[8.5px] font-medium text-slate-400">
                NNF – No Beta No Waste Food · Founded by Yesepu Ramanaboina
              </p>
            </div>
          </div>
        </div>

        {/* Buttons (Download PNG and Print) */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={isLoadingQr || !qrDataUrl}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-teal-400" />
            <span>Download PNG</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Pass</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};
