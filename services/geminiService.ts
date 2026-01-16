
import { GoogleGenAI, Type } from "@google/genai";
import { GuitarTabResult, VoicingPreference } from "../types";

export class TranscriptionError extends Error {
  constructor(public message: string, public code?: string, public originalError?: any) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Utility to strip markdown code blocks if the model accidentally includes them.
 */
const cleanJsonResponse = (text: string): string => {
  const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = text.match(jsonRegex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.trim();
};

export const generateGuitarTabFromAudio = async (
  base64Audio: string,
  mimeType: string,
  tuning: string = 'E Standard',
  voicingPreference: VoicingPreference = 'full'
): Promise<GuitarTabResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-pro-preview';

  const audioPart = {
    inlineData: {
      data: base64Audio,
      mimeType: mimeType,
    },
  };

  const textPart = {
    text: `
      Act as an elite Session Guitarist and Professional Music Transcriber. Provide a high-precision guitar transcription of this audio.

      CRITICAL TRANSCRIPTION RULES:
      1. SPECTRAL PRECISION: Isolate the fundamental frequency of the guitar. For dense mixes, use temporal cues to distinguish picking transients from other percussive elements.
      2. PHYSICAL PLAYABILITY: Map notes to "${tuning}" tuning. Prefer standard chord shapes and logical fretboard positions (e.g., if a note is G3, choose the 5th fret on the D string or 10th on the A string based on surrounding notes).
      3. RHYTHMIC GRID: Quantize to a 16th-note grid (0-15). Calculate exact BPM.
      4. HARMONIC CONTEXT: Identify at least one ${voicingPreference} chord per measure.
      5. JSON OUTPUT: You MUST return ONLY valid JSON. No conversational text. No markdown formatting outside of the JSON block.

      Think step-by-step about the spectral decomposition and fretboard logic before generating the final JSON structure.
    `
  };

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [audioPart, textPart] },
      config: {
        thinkingConfig: { thinkingBudget: 15000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            songTitle: { type: Type.STRING },
            key: { type: Type.STRING },
            tempo: { type: Type.NUMBER },
            tuning: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  measures: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        chords: { type: Type.ARRAY, items: { type: Type.STRING } },
                        notes: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              string: { type: Type.NUMBER },
                              fret: { type: Type.STRING },
                              position: { type: Type.NUMBER },
                              confidence: { type: Type.NUMBER }
                            },
                            required: ["string", "fret", "position"]
                          }
                        }
                      },
                      required: ["chords", "notes"]
                    }
                  }
                },
                required: ["title", "measures"]
              }
            },
            rawAscii: { type: Type.STRING }
          },
          required: ["songTitle", "tuning", "sections"]
        }
      }
    });

    if (!response.text) {
      // Check if the model stopped due to safety or other reasons
      const candidates = (response as any).candidates;
      if (candidates?.[0]?.finishReason === 'SAFETY') {
        throw new TranscriptionError("The audio was flagged by safety filters. This can happen with some copyrighted content or aggressive noise.", "SAFETY");
      }
      throw new TranscriptionError("The AI engine failed to return a valid response.", "EMPTY_RESPONSE");
    }

    const cleanedText = cleanJsonResponse(response.text);
    let parsed: GuitarTabResult;

    try {
      parsed = JSON.parse(cleanedText);
    } catch (e) {
      console.error("Raw AI Output failed parsing:", cleanedText);
      throw new TranscriptionError("The transcription was malformed. Please try a shorter or clearer audio clip.", "PARSE_ERROR", e);
    }

    // Deep validation and sanitization
    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      throw new TranscriptionError("The transcription contains no musical sections.", "INVALID_STRUCTURE");
    }

    parsed.sections.forEach(section => {
      if (!section.measures) section.measures = [];
      section.measures.forEach(measure => {
        if (!measure.notes) measure.notes = [];
        if (!measure.chords) measure.chords = [];
        
        // Final sanity check on note values
        measure.notes = measure.notes
          .filter(n => n && typeof n.string === 'number' && n.position >= 0)
          .map(note => ({
            ...note,
            string: Math.min(Math.max(1, Math.round(note.string)), 6),
            position: Math.min(Math.max(0, Math.round(note.position)), 15),
            fret: note.fret?.toString() || '0'
          }))
          .sort((a, b) => a.position - b.position);
      });
    });

    return parsed;
  } catch (error: any) {
    if (error instanceof TranscriptionError) throw error;

    const errorMsg = error.message?.toLowerCase() || "";
    if (errorMsg.includes("429") || errorMsg.includes("quota")) {
      throw new TranscriptionError("API quota exceeded. Please wait 60 seconds and try again.", "QUOTA");
    }
    if (errorMsg.includes("403") || errorMsg.includes("permission")) {
      throw new TranscriptionError("Access denied. Please check your API configuration.", "AUTH");
    }
    if (errorMsg.includes("network") || errorMsg.includes("fetch")) {
      throw new TranscriptionError("Network connection issue. Please check your internet.", "NETWORK");
    }

    throw new TranscriptionError(
      "An unexpected error occurred during transcription. The audio might be too large or complex.",
      "UNKNOWN",
      error
    );
  }
};
