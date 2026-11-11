// MIDIノート番号: C4 = 60 とする一般的な数え方
export const MIN_MIDI = 24; // C1
export const MAX_MIDI = 96; // C7

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(midi: number): string {
  return NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function isBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}
