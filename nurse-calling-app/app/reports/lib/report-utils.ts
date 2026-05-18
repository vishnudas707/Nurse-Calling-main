export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallRecord = any;

export function toDayKey(value: unknown) {
  if (!value) return "";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getLagMinutes(call: CallRecord) {
  if (!call?.timestamp || !call?.dateTimeReset) return null;
  const start = new Date(call.timestamp).getTime();
  const end = new Date(call.dateTimeReset).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

export type ReportFilterParams = {
  startDate?: string;
  endDate?: string;
  search?: string;
  statusFilter?: string;
  roomFilter?: string;
  mutedFilter?: string;
};

export function buildHistoryQueryParams(filters: ReportFilterParams, page = 1, pageSize = 100000) {
  const params: string[] = [];
  if (filters.startDate) params.push(`startDate=${encodeURIComponent(filters.startDate)}`);
  if (filters.endDate) params.push(`endDate=${encodeURIComponent(filters.endDate)}`);
  if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`);
  if (filters.statusFilter) params.push(`status=${encodeURIComponent(filters.statusFilter)}`);
  if (filters.roomFilter) params.push(`room=${encodeURIComponent(filters.roomFilter)}`);
  if (filters.mutedFilter) params.push(`muted=${encodeURIComponent(filters.mutedFilter)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return params.join("&");
}

export function computeCallsPerDay(allCalls: CallRecord[]) {
  const map = new Map<string, number>();
  for (const c of allCalls) {
    const k = toDayKey(c?.timestamp);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function computeCallsPerRoom(allCalls: CallRecord[]) {
  const map = new Map<string, number>();
  for (const c of allCalls) {
    const k = c?.roomName || c?.roomId || "Unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([room, count]) => ({ room, count }))
    .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room));
}

export function computeLaggedAttendingCalls(allCalls: CallRecord[], lagThresholdMinutes: number) {
  const threshold = Number.isFinite(lagThresholdMinutes) ? lagThresholdMinutes : 15;
  const rows: CallRecord[] = [];
  for (const c of allCalls) {
    const lag = getLagMinutes(c);
    if (lag === null) continue;
    if (lag > threshold) {
      rows.push({ ...c, lagMinutes: lag });
    }
  }
  rows.sort((a, b) => (b.lagMinutes || 0) - (a.lagMinutes || 0));
  return rows;
}
