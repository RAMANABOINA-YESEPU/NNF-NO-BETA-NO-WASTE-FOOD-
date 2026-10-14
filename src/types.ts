export type HostelType = 'A' | 'B' | 'C' | 'D' | 'Other';

export type MealSession = 'Breakfast' | 'Lunch' | 'Dinner';

export type WasteLevel = 'None' | 'Low' | 'Medium' | 'High';

export interface Student {
  gr: string;
  name: string;
  hostel: HostelType;
  photoUrl?: string;
  hasPhoto?: boolean;
  phone?: string;
  faceDescriptor?: number[]; // 128-number vector for face recognition
  createdAt?: string;
  updatedAt?: string;
}

export interface FaceMatchCandidate {
  student: Student;
  distance: number;
  percentage: number;
  matchType: 'strong' | 'possible' | 'none';
}

export interface WasteRecord {
  id: string;
  studentGr: string;
  studentName: string;
  hostel: HostelType;
  timestamp: string;
  session: MealSession;
  wasteLevel: WasteLevel;
  reason: string;
  photoUrl: string;
  isVerified: boolean;
  createdAt?: string;
}

export interface SavedReport {
  id: string;
  title: string;
  date: string;
  session: MealSession | 'All';
  totalRecords: number;
  pdfUrl?: string;
  createdAt: string;
}

export interface AiMatchResult {
  matches: Array<{ gr: string; confidence: number }>;
  waste_level: WasteLevel;
  reason: string;
}
