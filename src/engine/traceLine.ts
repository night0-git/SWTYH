export interface LineRecorderTarget {
  setLine(line: number): void;
}

let activeRecorder: LineRecorderTarget | null = null;

export function setActiveLineRecorder(recorder: LineRecorderTarget | null): void {
  activeRecorder = recorder;
}

export function __traceLine(line: number): void {
  activeRecorder?.setLine(line);
}
