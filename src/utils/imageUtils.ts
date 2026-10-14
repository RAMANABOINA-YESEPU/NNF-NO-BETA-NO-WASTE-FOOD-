import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { MealSession } from '../types';

/**
 * Compresses an image to maximum 800px width/height and quality 0.82 JPEG.
 * Supports string (data URL), File, or Blob.
 */
export async function compressImage(
  imageSource: string | File | Blob,
  maxDimension = 800,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const handleLoad = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          reject(new Error('Image dimensions could not be read.'));
          return;
        }

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas 2d context for image processing.'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(jpegDataUrl);
      } catch (err: any) {
        reject(new Error(`Image compression failed: ${err?.message || err}`));
      }
    };

    img.onload = handleLoad;
    img.onerror = () => {
      reject(new Error('Failed to load image in browser.'));
    };

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        reject(new Error(`Failed to read image file: ${reader.error?.message || 'File read error'}`));
      };
      reader.readAsDataURL(imageSource);
    }
  });
}

/**
 * Uploads a base64 / data URL to Firebase Storage.
 * Falls back to returning the compressed data URL if Storage bucket is not available or blocked.
 */
export async function uploadPhoto(
  dataUrl: string,
  storagePath: string
): Promise<string> {
  if (!storage) {
    return dataUrl;
  }
  try {
    const storageRef = ref(storage, storagePath);
    await uploadString(storageRef, dataUrl, 'data_url');
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    console.warn(`Storage upload to ${storagePath} failed, storing compressed dataUrl inline:`, err);
    return dataUrl;
  }
}

/**
 * Hash a 4-digit PIN string using SHA-256 Web Crypto
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Automatically determine meal session by local current hour
 */
export function getMealSessionByTime(): MealSession {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return 'Breakfast';
  } else if (hour >= 11 && hour < 16) {
    return 'Lunch';
  } else {
    return 'Dinner';
  }
}
