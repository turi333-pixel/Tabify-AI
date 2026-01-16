
export interface TabNote {
  string: number; // 1 to 6
  fret: string | number;
  position: number; // horizontal position in the measure
  confidence?: number; // 0.0 to 1.0, where < 0.7 indicates uncertainty
}

export interface TabMeasure {
  chords: string[];
  notes: TabNote[];
}

export interface TabSection {
  title: string;
  measures: TabMeasure[];
}

export interface GuitarTabResult {
  songTitle: string;
  artist?: string;
  key?: string;
  tempo?: number;
  tuning?: string;
  sections: TabSection[];
  rawAscii?: string;
}

export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  RESULT = 'RESULT',
  ERROR = 'ERROR'
}

export type VoicingPreference = 'full' | 'simplified' | 'power';

export const VOICING_PREFERENCES: { id: VoicingPreference; label: string; description: string }[] = [
  { id: 'full', label: 'Full Jazz/Complex', description: 'Includes extensions (7ths, 9ths, etc.)' },
  { id: 'simplified', label: 'Simplified Triads', description: 'Basic major/minor shapes' },
  { id: 'power', label: 'Power Chords', description: 'Root-fifth "5" chords only' }
];

// Frequencies for open strings in various tunings (String 6 to 1)
export const TUNING_FREQS: Record<string, number[]> = {
  'E Standard': [82.41, 110.00, 146.83, 196.00, 246.94, 329.63],
  'Drop D': [73.42, 110.00, 146.83, 196.00, 246.94, 329.63],
  'D Standard': [73.42, 98.00, 130.81, 174.61, 220.00, 293.66],
  'Open G': [73.42, 98.00, 146.83, 196.00, 246.94, 293.66],
  'DADGAD': [73.42, 110.00, 146.83, 196.00, 220.00, 293.66],
};

export const TUNINGS = [
  { name: 'E Standard', notes: ['E', 'A', 'D', 'G', 'B', 'E'], label: 'E A D G B E' },
  { name: 'Drop D', notes: ['D', 'A', 'D', 'G', 'B', 'E'], label: 'D A D G B E' },
  { name: 'D Standard', notes: ['D', 'G', 'C', 'F', 'A', 'D'], label: 'D G C F A D' },
  { name: 'Open G', notes: ['D', 'G', 'D', 'G', 'B', 'D'], label: 'D G D G B D' },
  { name: 'DADGAD', notes: ['D', 'A', 'D', 'G', 'A', 'D'], label: 'D A D G A D' },
];
