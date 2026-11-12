import { MIN_MIDI, MAX_MIDI } from "@/lib/audio/notes";

export type MidiNote = {
  midi: number;
  start: number;
  length: number;
};

export type MidiFile = {
  notes: MidiNote[];
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  durationBeats: number;
  tempoChanges: number;
  timeSignatureChanges: number;
};

type TimedValue<T> = { tick: number; value: T };
type OpenNote = { midi: number; start: number };

function invalidMidi(): Error {
  return new Error("有効なStandard MIDI Fileではありません。");
}

export function parseMidiFile(data: ArrayBuffer): MidiFile {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  let offset = 0;
  let readLimit = bytes.length;

  function ensure(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > readLimit) {
      throw invalidMidi();
    }
  }

  function readU8(): number {
    ensure(1);
    return bytes[offset++];
  }

  function readU16(): number {
    ensure(2);
    const value = view.getUint16(offset);
    offset += 2;
    return value;
  }

  function readU32(): number {
    ensure(4);
    const value = view.getUint32(offset);
    offset += 4;
    return value;
  }

  function readText(length: number): string {
    ensure(length);
    let value = "";
    for (let i = 0; i < length; i++) value += String.fromCharCode(bytes[offset++]);
    return value;
  }

  function readVariableLength(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = readU8();
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw invalidMidi();
  }

  if (readText(4) !== "MThd") throw invalidMidi();
  const headerLength = readU32();
  if (headerLength < 6) throw invalidMidi();
  const headerEnd = offset + headerLength;
  ensure(headerLength);
  const format = readU16();
  const trackCount = readU16();
  const division = readU16();
  if (offset > headerEnd || format > 1 || trackCount === 0) {
    throw new Error("このMIDI形式には対応していません。");
  }
  offset = headerEnd;

  if ((division & 0x8000) !== 0 || division === 0) {
    throw new Error("SMPTEタイムコード形式のMIDIには対応していません。");
  }

  const notes: MidiNote[] = [];
  const tempos: TimedValue<number>[] = [];
  const signatures: TimedValue<{ beatsPerBar: number; beatUnit: number }>[] = [];
  let durationTicks = 0;
  let parsedTracks = 0;

  while (offset + 8 <= bytes.length && parsedTracks < trackCount) {
    const chunkType = readText(4);
    const chunkLength = readU32();
    ensure(chunkLength);
    const chunkEnd = offset + chunkLength;
    if (chunkType !== "MTrk") {
      offset = chunkEnd;
      continue;
    }
    parsedTracks++;
    readLimit = chunkEnd;

    let tick = 0;
    let lastTick = 0;
    let runningStatus = 0;
    const active = new Map<number, OpenNote[]>();
    const activeHead = new Map<number, number>();

    while (offset < chunkEnd) {
      tick += readVariableLength();
      lastTick = tick;
      let status = readU8();
      let firstData: number | null = null;
      if (status < 0x80) {
        if (runningStatus < 0x80 || runningStatus >= 0xf0) throw invalidMidi();
        firstData = status;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      } else if (status !== 0xff) {
        runningStatus = 0;
      }

      if (status === 0xff) {
        const type = readU8();
        const length = readVariableLength();
        ensure(length);
        const end = offset + length;
        if (type === 0x51 && length === 3) {
          tempos.push({ tick, value: (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2] });
        } else if (type === 0x58 && length >= 2) {
          const numerator = bytes[offset];
          const exponent = bytes[offset + 1];
          signatures.push({ tick, value: { beatsPerBar: numerator, beatUnit: 2 ** exponent } });
        }
        offset = end;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        offset += readVariableLength();
        ensure(0);
        if (offset > chunkEnd) throw invalidMidi();
        continue;
      }

      if (status >= 0xf0) throw invalidMidi();
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const first = firstData ?? readU8();
      const second = command === 0xc0 || command === 0xd0 ? 0 : readU8();
      if (first >= 0x80 || second >= 0x80) throw invalidMidi();

      if (command === 0x90 && second > 0) {
        const key = channel * 128 + first;
        const queue = active.get(key) ?? [];
        queue.push({ midi: first, start: tick });
        active.set(key, queue);
      } else if (command === 0x80 || (command === 0x90 && second === 0)) {
        const key = channel * 128 + first;
        const queue = active.get(key);
        const head = activeHead.get(key) ?? 0;
        const note = queue?.[head];
        if (note) {
          if (tick > note.start) {
            notes.push({
              midi: note.midi,
              start: note.start,
              length: tick - note.start,
            });
          }
          activeHead.set(key, head + 1);
        }
      }
    }
    if (offset !== chunkEnd) throw invalidMidi();
    readLimit = bytes.length;
    durationTicks = Math.max(durationTicks, lastTick);
  }

  if (parsedTracks !== trackCount || notes.length === 0) {
    throw new Error(
      parsedTracks !== trackCount
        ? "MIDIファイルのトラックをすべて読み込めませんでした。"
        : "MIDIファイルに読み込めるノートがありません。"
    );
  }

  tempos.sort((a, b) => a.tick - b.tick);
  signatures.sort((a, b) => a.tick - b.tick);
  const tempo = tempos.find((event) => event.value > 0)?.value ?? 500_000;
  const timeSignature = signatures.find(({ value }) =>
    value.beatsPerBar >= 1 &&
    value.beatsPerBar <= 16 &&
    [2, 4, 8, 16].includes(value.beatUnit)
  )?.value ?? { beatsPerBar: 4, beatUnit: 4 };
  const ticksPerBeat = division * (4 / timeSignature.beatUnit);

  return {
    notes: notes.map((note) => ({
      midi: note.midi,
      start: note.start / ticksPerBeat,
      length: note.length / ticksPerBeat,
    })),
    bpm: (60_000_000 / tempo) * (timeSignature.beatUnit / 4),
    beatsPerBar: timeSignature.beatsPerBar,
    beatUnit: timeSignature.beatUnit,
    durationBeats: durationTicks / ticksPerBeat,
    tempoChanges: tempos.length,
    timeSignatureChanges: signatures.length,
  };
}

export function isMidiPitchInRange(midi: number): boolean {
  return midi >= MIN_MIDI && midi <= MAX_MIDI;
}
