import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { Student } from '../types';

/**
 * Format payload for student QR: only contains unique ID (GR with NNF prefix)
 */
export function getStudentQrPayload(gr: string): string {
  return `NNF:${gr.trim().toUpperCase()}`;
}

/**
 * Parses scanned text from QR and extracts the GR number
 */
export function extractGrFromQrPayload(scannedText: string): string | null {
  if (!scannedText) return null;
  const trimmed = scannedText.trim();
  if (trimmed.startsWith('NNF:')) {
    return trimmed.substring(4).trim().toUpperCase();
  }
  // Also accept direct GR number if scanned
  if (trimmed.length >= 2 && trimmed.length <= 20) {
    return trimmed.toUpperCase();
  }
  return null;
}

/**
 * Generates a clean PNG Data URL for a given string
 */
export async function generateQrCodeDataUrl(
  text: string,
  width = 300
): Promise<string> {
  return QRCode.toDataURL(text, {
    width,
    margin: 1,
    color: {
      dark: '#0f172a', // Slate 900
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Loads an image URL and converts to clean JPEG data URL for jsPDF
 */
async function loadImgAsJpeg(
  url: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const width = img.naturalWidth || 300;
        const height = img.naturalHeight || 300;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ dataUrl, width, height });
      } catch (e) {
        if (url.startsWith('data:image/')) {
          resolve({ dataUrl: url, width: 300, height: 300 });
        } else {
          resolve(null);
        }
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Generates an A4 PDF containing 8 printable student ID cards per page
 * (2 columns x 4 rows) with photo, name, GR, hostel, QR code, and cut lines.
 */
export async function generateAllStudentsQrPdf(
  students: Student[],
  hostelFilter = 'All'
): Promise<{ blob: Blob; fileName: string }> {
  const filtered =
    hostelFilter === 'All'
      ? students
      : students.filter((s) => s.hostel === hostelFilter);

  // Pre-generate QR codes and pre-load face photos for all students in parallel
  const studentAssets = await Promise.all(
    filtered.map(async (st) => {
      const qrDataUrl = await generateQrCodeDataUrl(getStudentQrPayload(st.gr), 200);
      let faceImg: { dataUrl: string; width: number; height: number } | null = null;
      if (st.photoUrl) {
        faceImg = await loadImgAsJpeg(st.photoUrl);
      }
      return {
        student: st,
        qrDataUrl,
        faceImg,
      };
    })
  );

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 10;
  const marginY = 10;
  const cols = 2;
  const rows = 4;
  const cardsPerPage = cols * rows; // 8 cards per page

  const cardWidth = 90; // mm
  const cardHeight = 65; // mm
  const gapX = 10; // mm
  const gapY = 4; // mm

  let cardIndex = 0;

  for (let i = 0; i < studentAssets.length; i++) {
    const pageCardIdx = cardIndex % cardsPerPage;

    if (i > 0 && pageCardIdx === 0) {
      doc.addPage();
    }

    const col = pageCardIdx % cols;
    const row = Math.floor(pageCardIdx / cols);

    const x = marginX + col * (cardWidth + gapX);
    const y = marginY + row * (cardHeight + gapY);

    const asset = studentAssets[i];
    const { student, qrDataUrl, faceImg } = asset;

    // Dashed cut lines around card
    doc.setDrawColor(180, 190, 205);
    (doc as any).setLineDashPattern([2, 2], 0);
    doc.rect(x - 1, y - 1, cardWidth + 2, cardHeight + 2, 'S');
    (doc as any).setLineDashPattern([], 0); // Reset dash

    // Card background
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

    // Header strip
    doc.setFillColor(15, 118, 110); // Teal 700
    doc.roundedRect(x, y, cardWidth, 10, 2, 2, 'F');
    // Square off bottom corners of header
    doc.rect(x, y + 6, cardWidth, 4, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('NNF – HOSTEL MESS ID', x + 3, y + 6.5);

    doc.setFontSize(7);
    doc.text(`HOSTEL ${student.hostel}`, x + cardWidth - 3, y + 6.5, {
      align: 'right',
    });

    // Student Photo (Left)
    const photoX = x + 3;
    const photoY = y + 13;
    const photoW = 24;
    const photoH = 28;

    if (faceImg && faceImg.dataUrl) {
      try {
        let renderW = photoW;
        let renderH = (faceImg.height / faceImg.width) * renderW;
        if (renderH > photoH) {
          renderH = photoH;
          renderW = (faceImg.width / faceImg.height) * renderH;
        }
        const offX = photoX + (photoW - renderW) / 2;
        const offY = photoY + (photoH - renderH) / 2;
        doc.addImage(faceImg.dataUrl, 'JPEG', offX, offY, renderW, renderH);
      } catch {
        doc.setFillColor(241, 245, 249);
        doc.rect(photoX, photoY, photoW, photoH, 'F');
      }
    } else {
      doc.setFillColor(241, 245, 249);
      doc.rect(photoX, photoY, photoW, photoH, 'F');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text('No Photo', photoX + photoW / 2, photoY + photoH / 2, {
        align: 'center',
      });
    }

    // Photo frame border
    doc.setDrawColor(203, 213, 225);
    doc.rect(photoX, photoY, photoW, photoH, 'S');

    // Student Details (Center)
    const textX = photoX + photoW + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);

    // Truncate name if long
    const nameStr =
      student.name.length > 18
        ? student.name.substring(0, 16) + '...'
        : student.name;
    doc.text(nameStr, textX, y + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(13, 148, 136); // Teal 600
    doc.text(`GR: ${student.gr}`, textX, y + 24);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Hostel: ${student.hostel}`, textX, y + 29);
    doc.text('Mess Resident', textX, y + 34);

    // QR Code (Right)
    const qrSize = 26;
    const qrX = x + cardWidth - qrSize - 3;
    const qrY = y + 13;

    try {
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    } catch (e) {
      console.warn('QR addImage error:', e);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(148, 163, 184);
    doc.text('SCAN AT COUNTER', qrX + qrSize / 2, qrY + qrSize + 3, {
      align: 'center',
    });

    // Card Footer Bar with security note
    doc.setFillColor(248, 250, 252);
    doc.rect(x, y + cardHeight - 6, cardWidth, 6, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(x, y + cardHeight - 6, x + cardWidth, y + cardHeight - 6);

    doc.text(
      'Valid for Hostel Mess Only  •  Founded by Yesepu Ramanaboina',
      x + cardWidth / 2,
      y + cardHeight - 2.2,
      { align: 'center' }
    );

    cardIndex++;
  }

  // Requirement 2 & 3: at the END of the last page, add a closing section with a thin line and the text "Founded by Yesepu Ramanaboina", centered, followed by "NNF – No Beta No Waste Food"
  const cardsOnLastPage = cardIndex % cardsPerPage === 0 ? cardsPerPage : cardIndex % cardsPerPage;
  const lastRow = Math.ceil(cardsOnLastPage / cols);

  let closingY = marginY + lastRow * (cardHeight + gapY) + 12;
  if (cardsOnLastPage >= 7 || closingY > pageHeight - 32) {
    doc.addPage();
    closingY = 120;
  }

  // Thin line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  const lineHalfWidth = 45;
  doc.line(
    pageWidth / 2 - lineHalfWidth,
    closingY,
    pageWidth / 2 + lineHalfWidth,
    closingY
  );

  // Founded by Yesepu Ramanaboina
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 118, 110); // Teal 700
  doc.text('Founded by Yesepu Ramanaboina', pageWidth / 2, closingY + 5.5, {
    align: 'center',
  });

  // NNF – No Beta No Waste Food
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('NNF – No Beta No Waste Food', pageWidth / 2, closingY + 10.5, {
    align: 'center',
  });

  // Requirement 2 & 3: Also put "Founded by Yesepu Ramanaboina" in the footer of every page next to the page number
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 11, pageWidth - marginX, pageHeight - 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'NNF Hostel Mess Student QR Passes  •  Hostel Counter',
      marginX,
      pageHeight - 6.5
    );
    doc.text(
      `Founded by Yesepu Ramanaboina  •  Page ${p} of ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 6.5,
      { align: 'right' }
    );
  }

  const fileName = `NNF_Student_QR_Cards_${hostelFilter}_Hostel.pdf`;
  const blob = doc.output('blob');

  return { blob, fileName };
}
