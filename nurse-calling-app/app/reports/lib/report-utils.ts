import { getOrganisationId } from "../../lib/auth";
import { scopeQuery } from "../../lib/scope";
import type { Scope } from "../../lib/scope";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";

function organisationQueryPrefix() {
  const orgId = getOrganisationId();
  if (!orgId) return null;
  return `?organisationId=${encodeURIComponent(orgId)}`;
}

export function roomsApiUrl() {
  const prefix = organisationQueryPrefix();
  if (!prefix) throw new Error("Organisation ID is required");
  return `${API_BASE}/api/rooms${prefix}`;
}

export function callsHistoryUrl(query: string) {
  const prefix = organisationQueryPrefix();
  if (!prefix) throw new Error("Organisation ID is required");
  return `${API_BASE}/api/calls/history${prefix}&${query}`;
}

export function beaconLogsUrl(query: string) {
  const prefix = organisationQueryPrefix();
  if (!prefix) throw new Error("Organisation ID is required");
  return `${API_BASE}/api/beacon-logs${prefix}&${query}`;
}

export type BeaconFilterParams = {
  startDate?: string;
  endDate?: string;
  search?: string;
  /** "", "ringing", "clear" or "changed" - see the beacon-logs endpoint. */
  activity?: string;
  /**
   * A beacon belongs to a device, not to a floor, so this report narrows by HID
   * only. A floor-based scope leaves it showing every device.
   */
  hid?: string;
};

export function buildBeaconLogsParams(filters: BeaconFilterParams, page = 1, pageSize = 10) {
  const params: string[] = [];
  const normalizedStartDate = normalizeDateFilter(filters.startDate, "start");
  const normalizedEndDate = normalizeDateFilter(filters.endDate, "end");
  if (normalizedStartDate) params.push(`startDate=${encodeURIComponent(normalizedStartDate)}`);
  if (normalizedEndDate) params.push(`endDate=${encodeURIComponent(normalizedEndDate)}`);
  if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`);
  if (filters.activity) params.push(`activity=${encodeURIComponent(filters.activity)}`);
  if (filters.hid) params.push(`hid=${encodeURIComponent(filters.hid)}`);
  params.push(`page=${page}`);
  params.push(`pageSize=${pageSize}`);
  return params.join("&");
}

export type BeaconLogRoom = {
  deviceNo: string;
  roomName: string | null;
  status: number;
  statusLabel?: string;
};

export type BeaconLogRecord = {
  id: number;
  hid: string;
  receivedAt: string;
  roomCount: number;
  ringingCount: number;
  raised: number;
  resolved: number;
  restated: number;
  unchanged: number;
  summary: string;
  requestUrl: string | null;
  rooms: BeaconLogRoom[];
};

/** "R01 Emergency, R03 Code Blue" - the beacon's rooms as one readable cell. */
export function describeBeaconRooms(rooms: BeaconLogRoom[]): string {
  if (!rooms?.length) return "";
  return rooms
    .map((room) => {
      const label = room.statusLabel || String(room.status);
      const name = room.roomName ? ` (${room.roomName})` : "";
      return `R${String(room.deviceNo).padStart(2, "0")}${name} ${label}`;
    })
    .join(", ");
}

/** Local date and time, spelled out - a beacon row is worthless without it. */
export function formatBeaconTimestamp(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallRecord = any;

type RoomsCacheEntry = { orgKey: string; rooms: CallRecord[]; ts: number };
let roomsCache: RoomsCacheEntry | null = null;
const ROOMS_CACHE_MS = 5 * 60 * 1000;

export async function fetchRoomsCached(signal?: AbortSignal): Promise<CallRecord[]> {
  const orgKey = getOrganisationId() || "";
  if (!orgKey) return [];
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
  filters: ReportFilterParams,
  page: number,
  pageSize: number
) {
  return buildHistoryQueryParams(filters, page, pageSize);
}

/** Local calendar day bounds (12:00 AM - 11:59:59 PM) as ISO strings for the API. */
export function getLocalDayRange(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return {
    start: new Date(y, m, d, 0, 0, 0, 0).toISOString(),
    end: new Date(y, m, d, 23, 59, 59, 999).toISOString(),
  };
}

function normalizeDateFilter(value: string | undefined, mode: "start" | "end") {
  if (!value) return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const [y, m, d] = trimmed.split("-").map(Number);
  if (mode === "start") {
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
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

export function getCallStateLabel(call: CallRecord): "Active" | "Resolved" | "Beacon" {
  if (isCallActive(call)) return "Active";
  return isBeaconResolved(call) ? "Beacon" : "Resolved";
}

export function isDashboardResolved(call: CallRecord): boolean {
  return call?.resolvedManually === true || call?.resolvedManually === 1;
}

/**
 * Closed by a device beacon: the device had already cleared the call while the
 * dashboard still showed it active, and the next beacon swept it away. Worth
 * telling apart from an ordinary device reset - it marks a reset that never
 * reached us the first time round.
 */
export function isBeaconResolved(call: CallRecord): boolean {
  return call?.resolvedBy === "beacon";
}

export function getResolvedStatusClassName(call: CallRecord): string {
  if (isCallActive(call)) {
    return "inline-block rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (isBeaconResolved(call)) {
    return "inline-block rounded-full px-3 py-1 text-xs font-semibold bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200";
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
  /** Device / floor scope, narrowed in SQL - see buildHistoryQueryParams. */
  scope?: Scope;
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
  // The server narrows by scope so paging and totals stay honest; filtering a
  // fetched page here would report the wrong count and drop rows.
  if (filters.scope) {
    const scoped = scopeQuery(filters.scope);
    if (scoped) params.push(scoped.slice(1));
  }
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
