// THE CLOUD MENU'S WORDS AND NUMBERS (tests/the-cloud-button-chooses-where-threads-run).
// The button and the menu are drawn in threads/Pages.tsx, beside the filters
// button and built like its menu; what they say lives here.

export type CloudMode = 'mac' | 'full' | 'all';

export interface CloudMonth {
  runs: number;
  agentHours: number;
  estimatedCost: number;
  costPerAgentHour: number | null;
}

export interface CloudStatus {
  setUp: boolean;
  mode: CloudMode;
  running: number;
  month: CloudMonth;
}

export const CLOUD_MODES: { id: CloudMode; label: string; note: string }[] = [
  { id: 'mac', label: 'This Mac only', note: 'Threads that don’t fit wait for a free agent.' },
  { id: 'full', label: 'When this Mac is full', note: 'Threads that don’t fit here start in the cloud.' },
  { id: 'all', label: 'Everything', note: 'Threads start in the cloud first, wherever they can.' },
];

// `cloudRuns` in the config, read the way the supervisor reads it: false is
// off, 'all' is everything, anything else is "when this Mac is full".
export function cloudModeOf(cloudRuns: unknown): CloudMode {
  if (cloudRuns === false) return 'mac';
  if (cloudRuns === 'all') return 'all';
  return 'full';
}

export function cloudButtonCount(status: { running: number } | null | undefined): number | null {
  return status && status.running > 0 ? status.running : null;
}

const hours = (n: number) => String(Math.round(n * 10) / 10);

export function cloudMonthLine(month: CloudMonth): string {
  if (!month.runs) return 'Nothing in the cloud yet this month';
  const base = `${hours(month.agentHours)} agent-hours`;
  return month.costPerAgentHour != null ? `${base} · about $${month.estimatedCost.toFixed(2)}` : base;
}
