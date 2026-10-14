import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Use AI Studio built-in provisioned Firebase configuration
export const databaseId = firebaseConfig.firestoreDatabaseId;
export const activeConfig = firebaseConfig;

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

export const missingFirebaseConfigs: string[] = [];
if (!firebaseConfig.apiKey) missingFirebaseConfigs.push('apiKey');
if (!firebaseConfig.projectId) missingFirebaseConfigs.push('projectId');

const app = isFirebaseConfigured
  ? getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApp()
  : null;

// Initialize Firestore with experimentalAutoDetectLongPolling: true and persistentLocalCache
let firestoreInstance: any = null;
if (app) {
  try {
    firestoreInstance = initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch (cacheErr: any) {
    try {
      firestoreInstance = initializeFirestore(
        app,
        {
          experimentalAutoDetectLongPolling: true,
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch (err: any) {
      console.warn('initializeFirestore already called, falling back to getFirestore:', err);
      firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
}

export const db = firestoreInstance;
export const storage = app ? getStorage(app) : (null as any);
export const auth = app ? getAuth(app) : (null as any);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
