import { Student, FaceMatchCandidate } from '../types';

declare global {
  interface Window {
    faceapi: any;
  }
}

// Public CDN weight paths for face-api.js models
const PRIMARY_WEIGHTS_URL = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@master/weights';
const FALLBACK_WEIGHTS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

let isModelLoaded = false;
let modelLoadingPromise: Promise<boolean> | null = null;

/**
 * Dynamically ensures the face-api.js library script is loaded in the browser window
 */
export async function ensureFaceApiLibrary(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('face-api.js can only run in a browser environment.');
  }

  if (window.faceapi) {
    return window.faceapi;
  }

  return new Promise((resolve, reject) => {
    // Check if script tag already exists
    const existingScript = document.querySelector('script[src*="face-api"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.faceapi));
      existingScript.addEventListener('error', (e) => reject(e));
      // In case it finished before listener attached
      if (window.faceapi) {
        resolve(window.faceapi);
        return;
      }
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (window.faceapi) {
        resolve(window.faceapi);
      } else {
        reject(new Error('faceapi global object not found after script load.'));
      }
    };
    script.onerror = () => {
      // Try fallback CDN for script
      const fallbackScript = document.createElement('script');
      fallbackScript.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
      fallbackScript.onload = () => resolve(window.faceapi);
      fallbackScript.onerror = (err) => reject(err);
      document.head.appendChild(fallbackScript);
    };
    document.head.appendChild(script);
  });
}

/**
 * Loads the three essential models:
 * 1. tinyFaceDetector
 * 2. faceLandmark68Net
 * 3. faceRecognitionNet
 */
export async function loadFaceApiModels(
  onProgress?: (status: string) => void
): Promise<boolean> {
  if (isModelLoaded) return true;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    try {
      onProgress?.('Loading face recognition library...');
      const faceapi = await ensureFaceApiLibrary();

      // Check if all 3 nets are already loaded
      if (
        faceapi.nets.tinyFaceDetector.isLoaded &&
        faceapi.nets.faceLandmark68Net.isLoaded &&
        faceapi.nets.faceRecognitionNet.isLoaded
      ) {
        isModelLoaded = true;
        return true;
      }

      onProgress?.('Loading face recognition models (tinyFaceDetector, faceLandmark68Net, faceRecognitionNet)...');

      // Try primary CDN URL, then fallback CDN URL
      let loadedSuccessfully = false;
      for (const weightsUrl of [PRIMARY_WEIGHTS_URL, FALLBACK_WEIGHTS_URL]) {
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(weightsUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(weightsUrl),
            faceapi.nets.faceRecognitionNet.loadFromUri(weightsUrl),
          ]);
          loadedSuccessfully = true;
          break;
        } catch (loadErr) {
          console.warn(`Failed loading models from ${weightsUrl}, trying fallback...`, loadErr);
        }
      }

      if (!loadedSuccessfully) {
        throw new Error('Could not load face recognition neural network weights from CDNs.');
      }

      isModelLoaded = true;
      onProgress?.('Face recognition models loaded ready.');
      return true;
    } catch (err: any) {
      console.error('Model loading failed:', err);
      modelLoadingPromise = null; // allow retry
      throw err;
    }
  })();

  return modelLoadingPromise;
}

/**
 * Helper to turn a base64 string or image URL into an HTMLImageElement
 */
export function createImageFromSource(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image for face detection.'));
    img.src = src;
  });
}

/**
 * Detects face(s) in an image and computes the 128-number face descriptor.
 * Requirement 5: If several faces are in the photo, uses the largest face.
 * Returns null if no face is detected.
 */
export async function detectLargestFaceDescriptor(
  imageSource: HTMLImageElement | HTMLCanvasElement | string,
  onStatus?: (msg: string) => void
): Promise<{
  descriptor: number[];
  allFacesCount: number;
  box: { x: number; y: number; width: number; height: number };
} | null> {
  await loadFaceApiModels(onStatus);
  const faceapi = window.faceapi;

  let imgElement: HTMLImageElement | HTMLCanvasElement;
  if (typeof imageSource === 'string') {
    imgElement = await createImageFromSource(imageSource);
  } else {
    imgElement = imageSource;
  }

  // Use TinyFaceDetector with 320 input size for fast and accurate browser detection
  const detections = await faceapi
    .detectAllFaces(imgElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections || detections.length === 0) {
    return null;
  }

  // Requirement 5: If several faces are in the photo, use the largest face by bounding box area
  detections.sort((a: any, b: any) => {
    const areaA = a.detection.box.width * a.detection.box.height;
    const areaB = b.detection.box.width * b.detection.box.height;
    return areaB - areaA;
  });

  const largest = detections[0];
  const box = {
    x: Math.round(largest.detection.box.x),
    y: Math.round(largest.detection.box.y),
    width: Math.round(largest.detection.box.width),
    height: Math.round(largest.detection.box.height),
  };

  return {
    descriptor: Array.from(largest.descriptor), // convert Float32Array to number[128]
    allFacesCount: detections.length,
    box,
  };
}

/**
 * Calculates standard Euclidean distance between two 128-dimensional vectors
 */
export function calculateEuclideanDistance(desc1: number[], desc2: number[]): number {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    return 1.0;
  }
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Computes match percentage from distance:
 * - Distance < 0.5: Strong match (~75% - 100%)
 * - 0.5 to 0.6: Possible match (~50% - 74%)
 * - > 0.6: No match (< 50%)
 */
export function calculateMatchPercentage(distance: number): number {
  if (distance <= 0) return 100;
  if (distance >= 0.85) return 0;
  if (distance <= 0.5) {
    // Range 0.0 -> 0.5 maps to 100% -> 75%
    return Math.round(100 - (distance / 0.5) * 25);
  } else if (distance <= 0.6) {
    // Range 0.5 -> 0.6 maps to 74% -> 50%
    const ratio = (distance - 0.5) / 0.1;
    return Math.round(74 - ratio * 24);
  } else {
    // Range 0.6 -> 0.85 maps to 49% -> 0%
    const ratio = (distance - 0.6) / 0.25;
    return Math.max(0, Math.round(49 - ratio * 49));
  }
}

/**
 * Classifies match type according to user specification:
 * - Below 0.5: strong match
 * - 0.5 to 0.6: "possible match, please confirm"
 * - Above 0.6: no match
 */
export function getMatchType(distance: number): 'strong' | 'possible' | 'none' {
  if (distance < 0.5) return 'strong';
  if (distance <= 0.6) return 'possible';
  return 'none';
}

/**
 * Requirement 3: Compare detected face descriptor against all registered students'
 * saved descriptors using Euclidean distance, sort by distance ascending, and return top 3.
 */
export function matchFaceAgainstStudents(
  queryDescriptor: number[],
  students: Student[]
): FaceMatchCandidate[] {
  if (!queryDescriptor || queryDescriptor.length !== 128) {
    return [];
  }

  // Filter students who have valid 128-number descriptors
  const candidatesWithDescriptors = students.filter(
    (s) => s.faceDescriptor && Array.isArray(s.faceDescriptor) && s.faceDescriptor.length === 128
  );

  if (candidatesWithDescriptors.length === 0) {
    return [];
  }

  // Compute distance for each candidate
  const scored = candidatesWithDescriptors.map((student) => {
    const distance = calculateEuclideanDistance(queryDescriptor, student.faceDescriptor!);
    const percentage = calculateMatchPercentage(distance);
    const matchType = getMatchType(distance);
    return {
      student,
      distance,
      percentage,
      matchType,
    };
  });

  // Sort ascending by distance (lowest distance = highest match)
  scored.sort((a, b) => a.distance - b.distance);

  // Return top 3 matches
  return scored.slice(0, 3);
}
