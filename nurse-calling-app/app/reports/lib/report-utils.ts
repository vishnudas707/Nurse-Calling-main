import { getOrganisationId } from "../../lib/auth";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";

function organisationQueryPrefix() {
  const orgId = getOrganisationId();
  return orgId ? `?organisationId=${encodeURIComponent(orgId)}` : "";
}

export function roomsApiUrl() {
  return `${API_BASE}/api/rooms${organisationQueryPrefix()}`;
}

export function callsHistoryUrl(query: string) {
  const prefix = organisationQueryPrefix();
  return `${API_BASE}/api/calls/history${prefix ? prefix + "&" : "?"}${query}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallRecord = any;

type RoomsCacheEntry = { orgKey: string; rooms: CallRecord[]; ts: number };
let roomsCache: RoomsCacheEntry | null = null;
const ROOMS_CACHE_MS = 5 * 60 * 1000;

export async function fetchRoomsCached(signal?: AbortSignal): Promise<CallRecord[]> {
  const orgKey = getOrganisationId() || "";
  const now = Date.now();
  if (roomsCache && roomsCache.orgKey === orgKey && now - roomsCache.ts < ROOMS_CACHE_MS) {
    return roomsCache.rooms;
  }
  const resp = await fetch(roomsApiUrl(), { signal });
  const data = await resp.json();
  if (!resp.ok || !data.success) {
    throw new Error("Failed to fetch rooms");
  }
  const rooms = data.data || [];
  roomsCache = { orgKey, rooms, ts: now };
  return rooms;
}

export function buildCallsHistoryParams(
  filters: {
    startDate?: string;
    endDate?: string;
    search?: string;
    statusFilter?: string;
    roomFilter?: string;
    mutedFilter?: string;
  },
  page: number,
  pageSize: number
) {
  const params: string[] = [];
  const normalizedStartDate = normalizeDateFilter(filters.startDate, "start");
  const normalizedEndDate = normalizeDateFilter(filters.endDate, "end");
  if (normalizedStartDate) params.push(`startDate=${encodeURIComponent(normalizedStartDate)}`);
  if (normalizedEndDate) params.push(`endDate=${encodeURIComponent(normalizedEndDate)}`);
  if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`);
  if (filters.statusFilter) params.push(`status=${encodeURIComponent(filters.statusFilter)}`);
  if (filters.roomFilter) params.push(`room=${encodeURIComponent(filters.roomFilter)}`);
  if (filters.mutedFilter) params.push(`muted=${encodeURIComponent(filters.mutedFilter)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return params.join("&");
}

function normalizeDateFilter(value: string | undefined, mode: "start" | "end") {
  if (!value) return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return mode === "start" ? `${trimmed}T00:00:00.000` : `${trimmed}T23:59:59.999`;
}

export function toDayKey(value: unknown) {
  if (!value) return "";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isCallActive(call: CallRecord): boolean {
  if (call?.dateTimeReset) return false;
  if (call?.isActive !== undefined) return Boolean(call.isActive);
  return Number(call?.status) !== 0;
}

export function getCallStateLabel(call: CallRecord): "Active" | "Resolved" {
  return isCallActive(call) ? "Active" : "Resolved";
}

export function isDashboardResolved(call: CallRecord): boolean {
  return call?.resolvedManually === true || call?.resolvedManually === 1;
}

export function getResolvedStatusClassName(call: CallRecord): string {
  if (isCallActive(call)) {
    return "inline-block rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (isDashboardResolved(call)) {
    return "inline-block rounded-full px-3 py-1 text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  return "inline-block rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300";
}

export function getLagMinutes(call: CallRecord) {
  if (!call?.timestamp || !call?.dateTimeReset) return null;
  const start = new Date(call.timestamp).getTime();
  const end = new Date(call.dateTimeReset).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

export function getCallReportSortTime(call: CallRecord) {
  const candidates = [call?.timestamp, call?.dateTimeReset, call?.lastRepeatAt];
  let max = 0;
  for (const value of candidates) {
    if (!value) continue;
    const time = new Date(value as string).getTime();
    if (!Number.isNaN(time) && time > max) max = time;
  }
  return max;
}

export function sortCallsForReportTable(calls: CallRecord[]) {
  return [...calls].sort((a, b) => {
    const diff = getCallReportSortTime(b) - getCallReportSortTime(a);
    if (diff !== 0) return diff;
    return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
  });
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
  const normalizedStartDate = normalizeDateFilter(filters.startDate, "start");
  const normalizedEndDate = normalizeDateFilter(filters.endDate, "end");
  if (normalizedStartDate) params.push(`startDate=${encodeURIComponent(normalizedStartDate)}`);
  if (normalizedEndDate) params.push(`endDate=${encodeURIComponent(normalizedEndDate)}`);
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
