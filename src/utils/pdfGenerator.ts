import jsPDF from 'jspdf';
import { WasteRecord, MealSession } from '../types';

/**
 * Loads an image URL and converts it to a clean JPEG data URL to insert into jsPDF.
 * Times out after 6 seconds so it never hangs PDF generation.
 */
async function loadImgAsJpeg(
  url: string
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!url || typeof url !== 'string') return null;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 6000);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const width = img.naturalWidth || img.width || 400;
        const height = img.naturalHeight || img.height || 300;
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
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ dataUrl, width, height });
      } catch (e) {
        console.warn('Canvas conversion error in loadImgAsJpeg:', e);
        if (url.startsWith('data:image/')) {
          resolve({
            dataUrl: url,
            width: img.naturalWidth || 400,
            height: img.naturalHeight || 300,
          });
        } else {
          resolve(null);
        }
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };

    img.src = url;
  });
}

export interface PdfReportOptions {
  date: string;
  session: MealSession | 'All';
  records: WasteRecord[];
  verifiedOnly: boolean;
}

export async function generateWastePdfReport(
  options: PdfReportOptions
): Promise<{ doc: jsPDF; blob: Blob; fileName: string }> {
  const { date, session, records, verifiedOnly } = options;

  // Filter records: Medium and High waste only
  let targetRecords = records.filter(
    (r) => r.wasteLevel === 'Medium' || r.wasteLevel === 'High'
  );

  if (verifiedOnly) {
    targetRecords = targetRecords.filter((r) => r.isVerified);
  }

  // Pre-load all images concurrently with Promise.all before creating PDF
  const imageMap = new Map<
    string,
    { dataUrl: string; width: number; height: number } | null
  >();

  await Promise.all(
    targetRecords.map(async (record) => {
      if (record.photoUrl) {
        try {
          const loaded = await loadImgAsJpeg(record.photoUrl);
          imageMap.set(record.id, loaded);
        } catch {
          imageMap.set(record.id, null);
        }
      } else {
        imageMap.set(record.id, null);
      }
    })
  );

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Summary by hostel
  const hostels = ['A', 'B', 'C', 'D', 'Other'] as const;
  const statsByHostel: Record<string, { total: number; medium: number; high: number }> = {};
  hostels.forEach((h) => {
    statsByHostel[h] = { total: 0, medium: 0, high: 0 };
  });

  targetRecords.forEach((r) => {
    const h = statsByHostel[r.hostel] ? r.hostel : 'Other';
    statsByHostel[h].total += 1;
    if (r.wasteLevel === 'Medium') statsByHostel[h].medium += 1;
    if (r.wasteLevel === 'High') statsByHostel[h].high += 1;
  });

  let currentY = margin;

  // Header on First Page
  const drawHeader = () => {
    // Title banner with Teal gradient feel
    doc.setFillColor(15, 118, 110); // Teal 700
    doc.roundedRect(margin, currentY, contentWidth, 26, 2, 2, 'F');

    // Requirement 11: Branded Header with NNF Logo Mark
    // White circular logo badge
    const logoX = margin + 8;
    const logoY = currentY + 13;
    doc.setFillColor(255, 255, 255);
    doc.circle(logoX, logoY, 7.5, 'F');
    // Inner emblem
    doc.setFillColor(15, 118, 110);
    doc.circle(logoX, logoY, 6.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('NNF', logoX, logoY + 2.5, { align: 'center' });

    // Brand Name and Subtitle
    const titleX = logoX + 11;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('NNF – NO BETA NO WASTE FOOD', titleX, currentY + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Hostel Mess Food Wastage Audit & Discipline Report', titleX, currentY + 16.5);
    doc.setFontSize(7.5);
    doc.setTextColor(204, 251, 241); // Teal 100
    doc.text('Mess Counter Monitoring System', titleX, currentY + 21.5);

    // Meta details on right
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    const metaDate = `Audit Date: ${date}`;
    const metaSession = `Session: ${session}`;
    const metaCount = `Wastage Cases: ${targetRecords.length} (Med/High)`;
    doc.text(metaDate, pageWidth - margin - 6, currentY + 9, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(metaSession, pageWidth - margin - 6, currentY + 14.5, { align: 'right' });
    doc.text(metaCount, pageWidth - margin - 6, currentY + 20, { align: 'right' });

    currentY += 30;

    // Requirement 11: Summary Section with a small Bar Chart of waste by hostel
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Summary & Distribution of Food Wastage by Hostel Block', margin, currentY);
    currentY += 4;

    // Table Header
    const tableW = contentWidth * 0.58;
    const chartW = contentWidth * 0.38;
    const chartX = margin + tableW + (contentWidth * 0.04);

    doc.setFillColor(241, 245, 249);
    doc.rect(margin, currentY, tableW, 6.5, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(51, 65, 85);

    const colWidths = [
      tableW * 0.30,
      tableW * 0.23,
      tableW * 0.23,
      tableW * 0.24,
    ];
    doc.text('Hostel Block', margin + 3, currentY + 4.5);
    doc.text('Med Waste', margin + colWidths[0] + 2, currentY + 4.5);
    doc.text('High Waste', margin + colWidths[0] + colWidths[1] + 2, currentY + 4.5);
    doc.text('Total Cases', margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 4.5);

    // Chart Box Header
    doc.setFillColor(241, 245, 249);
    doc.rect(chartX, currentY, chartW, 6.5, 'F');
    doc.text('Wastage Bar Chart (by Block)', chartX + 3, currentY + 4.5);

    currentY += 6.5;

    // Calculate maximum hostel count for chart scaling
    let maxHostelCount = 1;
    hostels.forEach((h) => {
      if (statsByHostel[h].total > maxHostelCount) {
        maxHostelCount = statsByHostel[h].total;
      }
    });

    // Table rows & Bar Chart rows side by side
    doc.setFont('helvetica', 'normal');
    const startTableY = currentY;

    hostels.forEach((h, idx) => {
      const data = statsByHostel[h];
      const rowY = startTableY + idx * 5.8;

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, rowY, tableW, 5.8, 'F');
        doc.rect(chartX, rowY, chartW, 5.8, 'F');
      }

      // Table row texts
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      doc.text(`Hostel ${h}`, margin + 3, rowY + 4.2);
      doc.text(`${data.medium}`, margin + colWidths[0] + 2, rowY + 4.2);
      doc.text(`${data.high}`, margin + colWidths[0] + colWidths[1] + 2, rowY + 4.2);
      doc.setFont('helvetica', 'bold');
      doc.text(`${data.total}`, margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, rowY + 4.2);

      // Bar Chart Draw (Horizontal Bar)
      const barMaxW = chartW - 22; // Leave room for label
      const barLen = maxHostelCount > 0 ? (data.total / maxHostelCount) * barMaxW : 0;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(`H-${h}:`, chartX + 2, rowY + 4);

      if (barLen > 0) {
        // Bar color: orange/red if higher, teal if moderate
        if (data.high > 0) {
          doc.setFillColor(239, 68, 68); // Red
        } else {
          doc.setFillColor(249, 115, 22); // Orange
        }
        doc.roundedRect(chartX + 11, rowY + 1.2, Math.max(barLen, 2), 3.4, 0.8, 0.8, 'F');
      } else {
        doc.setFillColor(203, 213, 225);
        doc.rect(chartX + 11, rowY + 2.5, 2, 1, 'F');
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(`${data.total}`, chartX + 12 + Math.max(barLen, 2) + 2, rowY + 4);
    });

    currentY = startTableY + hostels.length * 5.8 + 4;

    // Requirement 11: Legend for Waste Levels
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 7, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.text('Waste Level Legend:', margin + 3, currentY + 4.8);

    // Legend item 1: High
    doc.setFillColor(239, 68, 68);
    doc.circle(margin + 36, currentY + 3.8, 1.8, 'F');
    doc.text('High (>40% left)', margin + 40, currentY + 4.8);

    // Legend item 2: Medium
    doc.setFillColor(249, 115, 22);
    doc.circle(margin + 74, currentY + 3.8, 1.8, 'F');
    doc.text('Medium (10–40% left)', margin + 78, currentY + 4.8);

    // Legend item 3: Low
    doc.setFillColor(234, 179, 8);
    doc.circle(margin + 120, currentY + 3.8, 1.8, 'F');
    doc.text('Low (<10% left)', margin + 124, currentY + 4.8);

    // Legend item 4: None
    doc.setFillColor(16, 185, 129);
    doc.circle(margin + 154, currentY + 3.8, 1.8, 'F');
    doc.text('None (Clean plate)', margin + 158, currentY + 4.8);

    currentY += 10;
  };

  drawHeader();

  // Group records by Hostel
  const groupedByHostel: Record<string, WasteRecord[]> = {};
  hostels.forEach((h) => {
    groupedByHostel[h] = [];
  });
  targetRecords.forEach((r) => {
    const h = groupedByHostel[r.hostel] ? r.hostel : 'Other';
    groupedByHostel[h].push(r);
  });

  const cardHeight = 36; // mm
  const cardGap = 4; // mm

  for (const h of hostels) {
    const hostelRecords = groupedByHostel[h];
    if (hostelRecords.length === 0) continue;

    // Check if section header fits
    if (currentY + 12 > pageHeight - margin - 12) {
      doc.addPage();
      currentY = margin;
    }

    // Section header
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(margin, currentY, contentWidth, 7, 1, 1, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      `Hostel ${h} (${hostelRecords.length} student${
        hostelRecords.length > 1 ? 's' : ''
      } with wastage)`,
      margin + 4,
      currentY + 5
    );
    currentY += 10;

    for (const record of hostelRecords) {
      // Check if student card fits on current page
      if (currentY + cardHeight > pageHeight - margin - 12) {
        doc.addPage();
        currentY = margin;
      }

      // Requirement 11: Card Container with color-coded left border by waste level
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, currentY, contentWidth, cardHeight, 1.5, 1.5, 'FD');

      // Color-coded left border (3.5mm thick stripe)
      if (record.wasteLevel === 'High') {
        doc.setFillColor(239, 68, 68); // Red
      } else if (record.wasteLevel === 'Medium') {
        doc.setFillColor(249, 115, 22); // Orange
      } else if (record.wasteLevel === 'Low') {
        doc.setFillColor(234, 179, 8); // Yellow
      } else {
        doc.setFillColor(16, 185, 129); // Green
      }
      doc.roundedRect(margin, currentY, 3.5, cardHeight, 1, 0, 'F');

      // Requirement 11: Evidence Photo Box with rounded corners frame
      const imgX = margin + 6;
      const imgY = currentY + 3;
      const imgW = 40;
      const imgH = cardHeight - 6;

      // Rounded container outline for photo
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(imgX, imgY, imgW, imgH, 1.5, 1.5, 'FD');

      const loaded = imageMap.get(record.id);

      if (loaded && loaded.dataUrl) {
        try {
          // Keep correct aspect ratio inside imgW x imgH
          let renderW = imgW - 1;
          let renderH = (loaded.height / loaded.width) * renderW;
          if (renderH > imgH - 1) {
            renderH = imgH - 1;
            renderW = (loaded.width / loaded.height) * renderH;
          }
          const offsetX = imgX + (imgW - renderW) / 2;
          const offsetY = imgY + (imgH - renderH) / 2;
          doc.addImage(loaded.dataUrl, 'JPEG', offsetX, offsetY, renderW, renderH);
        } catch (e) {
          console.warn('doc.addImage error:', e);
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          doc.text('Photo', imgX + imgW / 2, imgY + imgH / 2, { align: 'center' });
        }
      } else {
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text('No Photo', imgX + imgW / 2, imgY + imgH / 2, { align: 'center' });
      }

      // Student info text
      const textX = imgX + imgW + 5;
      let textY = currentY + 7;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(record.studentName, textX, textY);

      textY += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `GR: ${record.studentGr}  |  Hostel: ${record.hostel}  |  Session: ${record.session}`,
        textX,
        textY
      );

      textY += 4.5;
      const recordDate = new Date(record.timestamp);
      const timeStr = !isNaN(recordDate.getTime())
        ? recordDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : record.timestamp;
      doc.text(
        `Time: ${timeStr}  |  Status: ${
          record.isVerified ? 'Verified by Manager' : 'Pending Verification'
        }`,
        textX,
        textY
      );

      // Waste Level Badge
      textY += 6;
      if (record.wasteLevel === 'High') {
        doc.setFillColor(239, 68, 68); // Red
      } else if (record.wasteLevel === 'Medium') {
        doc.setFillColor(249, 115, 22); // Orange
      } else {
        doc.setFillColor(234, 179, 8); // Yellow
      }
      doc.roundedRect(textX, textY - 3.5, 26, 5, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(`WASTE: ${record.wasteLevel.toUpperCase()}`, textX + 13, textY, {
        align: 'center',
      });

      // Reason / notes
      if (record.reason) {
        doc.setTextColor(100, 116, 139);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        const splitReason = doc.splitTextToSize(
          `Note: ${record.reason}`,
          contentWidth - (imgW + 15)
        );
        doc.text(splitReason, textX, textY + 6);
      }

      currentY += cardHeight + cardGap;
    }

    currentY += 3;
  }

  // Add Closing Section at the END of the last page
  // Requirement 2: at the END of the last page, add a closing section with a thin line and the text "Founded by Yesepu Ramanaboina", centered, followed by "NNF – No Beta No Waste Food"
  if (currentY + 22 > pageHeight - margin - 12) {
    doc.addPage();
    currentY = margin + 10;
  }

  const closingY = Math.max(currentY + 8, pageHeight - margin - 26);

  // Thin line centered
  doc.setDrawColor(203, 213, 225); // Slate 300
  doc.setLineWidth(0.3);
  const lineHalfWidth = 45;
  doc.line(
    pageWidth / 2 - lineHalfWidth,
    closingY,
    pageWidth / 2 + lineHalfWidth,
    closingY
  );

  // Text "Founded by Yesepu Ramanaboina", centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 118, 110); // Teal 700
  doc.text('Founded by Yesepu Ramanaboina', pageWidth / 2, closingY + 5.5, {
    align: 'center',
  });

  // Followed by "NNF – No Beta No Waste Food"
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // Slate 500
  doc.text('NNF – No Beta No Waste Food', pageWidth / 2, closingY + 10.5, {
    align: 'center',
  });

  // Footer on Every Page: next to page number
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(
      margin,
      pageHeight - margin - 4,
      pageWidth - margin,
      pageHeight - margin - 4
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'To be verified by mess manager and submitted to warden',
      margin,
      pageHeight - margin
    );
    // Requirement 2: Also put "Founded by Yesepu Ramanaboina" in the footer of every page next to the page number
    doc.text(
      `Founded by Yesepu Ramanaboina  •  Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - margin,
      { align: 'right' }
    );
  }

  const fileName = `NNF-Report-${date}.pdf`;
  const blob = doc.output('blob');

  return { doc, blob, fileName };
}

/**
 * Requirement 3: Warning Evidence PDF for individual student food waste incident.
 * Generates an official single-page A4 warning and evidence notice for warden/discipline records.
 */
export async function generateWarningEvidencePdf(
  record: WasteRecord
): Promise<{ doc: jsPDF; blob: Blob; fileName: string }> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Pre-load the captured photo if available
  let loadedPhoto: { dataUrl: string; width: number; height: number } | null = null;
  if (record.photoUrl) {
    try {
      loadedPhoto = await loadImgAsJpeg(record.photoUrl);
    } catch {
      loadedPhoto = null;
    }
  }

  let currentY = margin;

  // Header Banner
  doc.setFillColor(15, 118, 110); // Teal 700
  doc.roundedRect(margin, currentY, contentWidth, 24, 2, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('NNF – NO BETA NO WASTE FOOD', margin + 6, currentY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Hostel Mess – Food Wastage Warning & Evidence Slip', margin + 6, currentY + 15);

  // Meta on right
  doc.setFontSize(8);
  const timeDate = new Date(record.timestamp);
  const dateStr = !isNaN(timeDate.getTime())
    ? timeDate.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
    : record.timestamp;
  const timeStr = !isNaN(timeDate.getTime())
    ? timeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  doc.text(`Ref: ${record.id.slice(-8).toUpperCase()}`, pageWidth - margin - 6, currentY + 9, {
    align: 'right',
  });
  doc.text(`${dateStr} ${timeStr}`, pageWidth - margin - 6, currentY + 15, {
    align: 'right',
  });

  currentY += 30;

  // Student Details Block
  doc.setFillColor(248, 250, 252); // slate 50
  doc.setDrawColor(203, 213, 225); // slate 300
  doc.roundedRect(margin, currentY, contentWidth, 28, 2, 2, 'FD');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(record.studentName, margin + 6, currentY + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(13, 148, 136); // Teal 600
  doc.text(`GR Number: ${record.studentGr}`, margin + 6, currentY + 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Hostel Block: ${record.hostel}    |    Meal Session: ${record.session}    |    Verification: ${
      record.isVerified ? 'Verified by Mess Manager' : 'Pending Verification'
    }`,
    margin + 6,
    currentY + 22
  );

  // Waste Level Badge on the right
  const badgeW = 34;
  const badgeH = 8;
  const badgeX = pageWidth - margin - badgeW - 6;
  const badgeY = currentY + 6;

  if (record.wasteLevel === 'High') {
    doc.setFillColor(239, 68, 68);
  } else if (record.wasteLevel === 'Medium') {
    doc.setFillColor(249, 115, 22);
  } else {
    doc.setFillColor(234, 179, 8);
  }
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`WASTE: ${record.wasteLevel.toUpperCase()}`, badgeX + badgeW / 2, badgeY + 5.5, {
    align: 'center',
  });

  currentY += 34;

  // Evidence Photo Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('Photographic Evidence & Leftover Assessment', margin, currentY);

  currentY += 4;

  const photoCardH = 86;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, photoCardH, 2, 2, 'FD');

  const imgW = 90;
  const imgH = photoCardH - 10;
  const imgX = margin + 5;
  const imgY = currentY + 5;

  if (loadedPhoto && loadedPhoto.dataUrl) {
    try {
      let renderW = imgW;
      let renderH = (loadedPhoto.height / loadedPhoto.width) * renderW;
      if (renderH > imgH) {
        renderH = imgH;
        renderW = (loadedPhoto.width / loadedPhoto.height) * renderH;
      }
      const offX = imgX + (imgW - renderW) / 2;
      const offY = imgY + (imgH - renderH) / 2;
      doc.addImage(loadedPhoto.dataUrl, 'JPEG', offX, offY, renderW, renderH);
    } catch {
      doc.setFillColor(241, 245, 249);
      doc.rect(imgX, imgY, imgW, imgH, 'F');
    }
  } else {
    doc.setFillColor(241, 245, 249);
    doc.rect(imgX, imgY, imgW, imgH, 'F');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('No Photo Available', imgX + imgW / 2, imgY + imgH / 2, { align: 'center' });
  }

  // Leftover note & inspection notes on the right of photo
  const noteX = imgX + imgW + 6;
  const noteW = contentWidth - imgW - 16;
  let noteY = currentY + 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('Auditor Observations:', noteX, noteY);

  noteY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  const reasonText = record.reason
    ? `"${record.reason}"`
    : 'Excess leftover observed on tray during counter return audit.';
  const splitNote = doc.splitTextToSize(reasonText, noteW);
  doc.text(splitNote, noteX, noteY);

  noteY += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(180, 83, 9); // Amber 700
  doc.text('Mess Policy Guidelines:', noteX, noteY);

  noteY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const policyText =
    'Take only what you consume. Food preparation is optimized per headcount to avoid collective waste. Clean trays reflect personal accountability.';
  doc.text(doc.splitTextToSize(policyText, noteW), noteX, noteY);

  currentY += photoCardH + 8;

  // Formal Warning Notice Box
  doc.setFillColor(254, 242, 242); // Rose 50
  doc.setDrawColor(254, 202, 202); // Rose 200
  doc.roundedRect(margin, currentY, contentWidth, 24, 2, 2, 'FD');

  doc.setTextColor(153, 27, 27); // Rose 800
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('OFFICIAL NOTICE & RECORD ENTRY', margin + 6, currentY + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(185, 28, 28);
  const warningNotice =
    'This slip records an instance of unconsumed food wastage logged by hostel mess counter staff. Students are expected to uphold zero-waste practices. Multiple infractions are escalated to the Hostel Warden and Mess Committee.';
  doc.text(doc.splitTextToSize(warningNotice, contentWidth - 12), margin + 6, currentY + 12);

  currentY += 32;

  // Signatures Section
  const sigW = contentWidth / 2 - 8;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, currentY + 12, margin + sigW, currentY + 12);
  doc.line(pageWidth - margin - sigW, currentY + 12, pageWidth - margin, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Mess Manager / Supervisor Signature', margin, currentY + 16);
  doc.text('Student Acknowledgment Signature', pageWidth - margin - sigW, currentY + 16);

  currentY += 24;

  // Requirement 2 & 3: at the END of the last page, add a closing section with a thin line and the text "Founded by Yesepu Ramanaboina", centered, followed by "NNF – No Beta No Waste Food"
  const closingY = Math.max(currentY + 4, pageHeight - margin - 26);

  // Thin line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(pageWidth / 2 - 45, closingY, pageWidth / 2 + 45, closingY);

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

  // Footer on page: next to page number
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(margin, pageHeight - margin - 4, pageWidth - margin, pageHeight - margin - 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Official Mess Disciplinary Evidence Notice', margin, pageHeight - margin);
  doc.text(
    'Founded by Yesepu Ramanaboina  •  Page 1 of 1',
    pageWidth - margin,
    pageHeight - margin,
    { align: 'right' }
  );

  const fileName = `NNF-Warning-${record.studentGr}-${record.id.slice(-6)}.pdf`;
  const blob = doc.output('blob');

  return { doc, blob, fileName };
}
