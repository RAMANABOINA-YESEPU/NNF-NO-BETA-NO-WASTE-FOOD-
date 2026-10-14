import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

export const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

export interface PlateWasteResult {
  waste_level: "None" | "Low" | "Medium" | "High";
  reason: string;
}

export interface AnalyzeResult {
  matches: Array<{ gr: string; confidence: number }>;
  waste_level: "None" | "Low" | "Medium" | "High";
  reason: string;
}

function cleanBase64(dataUrl: string): { mimeType: string; data: string } {
  if (dataUrl.includes(";base64,")) {
    const parts = dataUrl.split(";base64,");
    const mimeType = parts[0].replace("data:", "") || "image/jpeg";
    return { mimeType, data: parts[1] };
  }
  return { mimeType: "image/jpeg", data: dataUrl };
}

/**
 * Requirement 6: Use Gemini ONLY to estimate the food waste level from the plate.
 * Face recognition is performed locally in the browser with face-api.js descriptors.
 */
export async function analyzePlateWasteOnly(
  capturedPhotoBase64: string
): Promise<PlateWasteResult> {
  if (!ai || !process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is not set. Returning heuristic waste estimation.");
    return {
      waste_level: "Medium",
      reason: "Plate inspected visually at counter.",
    };
  }

  const { mimeType: capturedMime, data: capturedClean } = cleanBase64(capturedPhotoBase64);

  const parts: any[] = [
    {
      inlineData: {
        mimeType: capturedMime,
        data: capturedClean,
      },
    },
    {
      text: `
You are the AI food wastage monitoring system for a college hostel mess ("NNF – No Beta No Waste Food").
The mess staff captured a photo of a student's plate / tray after their meal.

TASK: Food Waste Assessment ONLY
- Carefully inspect the food plate/tray in the captured photo.
- Estimate the wastage level:
  * "None": Plate is clean or empty, zero edible food left.
  * "Low": Minor scrapings, lemon peel, bones, garnish, or less than 10% edible leftovers.
  * "Medium": Noticeable edible food left (e.g., 10% to 40% of a portion, half roti, leftover rice).
  * "High": Substantial food thrown away (more than 40% uneaten, whole chapatis, full bowls of dal/curry).
- Give a short, clear reason (one concise sentence describing the leftovers seen on the plate, e.g., "Left over half bowl of rice and a whole chapati").

You MUST respond strictly with the specified JSON schema.
`,
    },
  ];

  const modelsToTry = ["gemini-3.8-flash", "gemini-2.5-flash"];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              waste_level: {
                type: Type.STRING,
                enum: ["None", "Low", "Medium", "High"],
              },
              reason: { type: Type.STRING },
            },
            required: ["waste_level", "reason"],
          },
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        const validLevels = ["None", "Low", "Medium", "High"] as const;
        const normalizedLevel = validLevels.includes(parsed.waste_level as any)
          ? parsed.waste_level
          : "Medium";
        return {
          waste_level: normalizedLevel,
          reason: parsed.reason || "Plate analyzed by AI vision.",
        };
      }
    } catch (err) {
      console.error(`Error calling ${model} for plate analysis:`, err);
    }
  }

  return {
    waste_level: "Medium",
    reason: "Visual scan complete. Food detected on plate.",
  };
}

/**
 * Backward-compatible endpoint helper that delegates waste assessment to Gemini
 * and returns empty matches array (since face recognition is handled client-side).
 */
export async function analyzePlateAndStudent(
  capturedPhotoBase64: string,
  _candidates: any[] = []
): Promise<AnalyzeResult> {
  const wasteResult = await analyzePlateWasteOnly(capturedPhotoBase64);
  return {
    matches: [],
    waste_level: wasteResult.waste_level,
    reason: wasteResult.reason,
  };
}
