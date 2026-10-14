import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Student } from '../types';

export const INITIAL_STUDENTS: Student[] = [
  {
    gr: 'GR101',
    name: 'Aditya Verma',
    hostel: 'A',
    photoUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR102',
    name: 'Ananya Sharma',
    hostel: 'B',
    photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR103',
    name: 'Rohan Gupta',
    hostel: 'C',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR104',
    name: 'Sneha Patel',
    hostel: 'D',
    photoUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR105',
    name: 'Karan Malhotra',
    hostel: 'A',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR106',
    name: 'Priya Iyer',
    hostel: 'B',
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80',
    hasPhoto: true,
  },
  {
    gr: 'GR107',
    name: 'Vikram Choudhury',
    hostel: 'C',
    hasPhoto: false, // Intentionally no photo to showcase the warning badge!
  },
];

export async function seedInitialStudentsIfEmpty(): Promise<Student[]> {
  if (!db) return INITIAL_STUDENTS;
  try {
    const batch = writeBatch(db);
    INITIAL_STUDENTS.forEach((st) => {
      const ref = doc(db, 'students', st.gr);
      batch.set(ref, {
        ...st,
        createdAt: new Date().toISOString(),
      });
    });
    await batch.commit();
    return INITIAL_STUDENTS;
  } catch (err) {
    console.warn('Could not auto-seed students:', err);
    return INITIAL_STUDENTS;
  }
}
