"use client";

import TopNavBar from "../../components/navbar";
import { Card, Pagination, Select, Spinner, TextInput } from "flowbite-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeScope, useScope, useScopeOptions } from "../../lib/scope";
import {
  beaconLogsUrl,
  buildBeaconLogsParams,
  describeBeaconRooms,
  formatBeaconTimestamp,
} from "../lib/report-utils";
import type { BeaconLogRecord, BeaconLogRoom } from "../lib/report-utils";

const PAGE_SIZE_ALL = 100000;
const PAGE_SIZE_OPTIONS = [
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "500", value: "500" },
  { label: "All", value: "all" },
] as const;

const ACTIVITY_OPTIONS = [
  { label: "All beacons", value: "" },
  { label: "Rooms ringing", value: "ringing" },
  { label: "Panel all clear", value: "clear" },
  { label: "Changed the dashboard", value: "changed" },
] as const;

/** Same colours the call reports use, so a status reads the same everywhere. */
function statusClassName(status: number) {
  if (status === 2 || status === 4) return "bg-red-200 text-red-800";
  if (status === 3) return "bg-blue-200 text-blue-800";
  if (status === 1) return "bg-green-200 text-green-800";
  if (status === 5) return "bg-purple-200 text-purple-800";
  return "bg-gray-200 text-gray-800";
}

function roomLabel(room: BeaconLogRoom) {
  const deviceNo = `R${String(room.deviceNo).padStart(2, "0")}`;
  return room.roomName ? `${deviceNo} · ${room.roomName}` : deviceNo;
}

export default function BeaconDataPage() {
  const [logs, setLogs] = useState<BeaconLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [hidFilter, setHidFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [page, setPage] = useState(1);
  const [pageSizeOption, setPageSizeOption] = useState("10");
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // A beacon is a device's own snapshot, so this report narrows by HID. The
  // nav-bar scope seeds that choice when it names a device; a floor-based scope
  // has nothing to say about a beacon and leaves every device showing.
  const [scope] = useScope("primary");
  const { hids } = useScopeOptions();
  const scopeHid = scope.basis === "hid" ? scope.value : "";
  const hidOptions = useMemo(
    () => Array.from(new Set([...hids, ...(scopeHid ? [scopeHid] : [])])).sort(),
    [hids, scopeHid]
  );

  const apiPageSize = pageSizeOption === "all" ? PAGE_SIZE_ALL : Number(pageSizeOption);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Adopt the nav-bar device once it is known, without pinning the filter: the
  // user can still widen this page back to every device.
  useEffect(() => {
    setHidFilter(scopeHid);
    setPage(1);
  }, [scopeHid]);

  useEffect(() => {
    const ac = new AbortController();
    const fetchLogs = async () => {
      if (hasLoadedOnce.current) setIsRefreshing(true);
      else setIsLoading(true);
      setError("");
      try {
        const query = buildBeaconLogsParams(
          {
            startDate,
            endDate,
            search: debouncedSearch,
            activity: activityFilter,
            hid: hidFilter,
          },
          page,
          apiPageSize
        );
        const resp = await fetch(beaconLogsUrl(query), { signal: ac.signal });
        const data = await resp.json();
        if (resp.ok && data.success) {
          setLogs(data.data || []);
          setTotalPages(data.totalPages || 1);
          setTotalCount(data.totalCount ?? (data.data?.length || 0));
          hasLoadedOnce.current = true;
        } else {
          setLogs([]);
          setTotalCount(0);
          setTotalPages(1);
          setError(data?.error || "Failed to fetch beacon data");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Error connecting to server");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };
    fetchLogs();
    return () => ac.abort();
  }, [startDate, endDate, debouncedSearch, activityFilter, hidFilter, page, apiPageSize]);

  const rangeStart = totalCount === 0 ? 0 : (page - 1) * apiPageSize + 1;
  const rangeEnd = Math.min(page * apiPageSize, totalCount);
  const showPagination = pageSizeOption !== "all" && totalPages > 1;

  const handlePageSizeChange = (value: string) => {
    setPageSizeOption(value);
    setPage(1);
  };

  const exportRows = useCallback(
    () =>
      logs.map((log) => ({
        "Date & Time": formatBeaconTimestamp(log.receivedAt),
        "HID": log.hid,
        "Rooms Reported": log.roomCount,
        "Rooms Ringing": log.ringingCount,
        "Rooms": describeBeaconRooms(log.rooms),
        "Raised": log.raised,
        "Resolved": log.resolved,
        "Restated": log.restated,
        "Unchanged": log.unchanged,
        "Result": log.summary,
      })),
    [logs]
  );

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const fileSaver = await import("file-saver");
    const saveAs = fileSaver.saveAs ?? fileSaver.default;
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BeaconData");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buf], { type: "application/octet-stream" }), "beacon_data.xlsx");
  };

  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text(`Beacon Data — ${hidFilter ? `HID ${hidFilter}` : describeScope(scope)}`, 14, 16);
    autoTable(doc, {
      startY: 22,
      styles: { fontSize: 8, cellWidth: "wrap" },
      head: [[
        "Date & Time",
        "HID",
        "Reported",
        "Ringing",
        "Rooms",
        "Raised",
        "Resolved",
        "Restated",
        "Unchanged",
      ]],
      body: logs.map((log) => [
        formatBeaconTimestamp(log.receivedAt),
        log.hid,
        log.roomCount,
        log.ringingCount,
        describeBeaconRooms(log.rooms),
        log.raised,
        log.resolved,
        log.restated,
        log.unchanged,
      ]),
    });
    doc.save("beacon_data.pdf");
  };

  return (
    <div className="page-shell">
      <TopNavBar />
      <div className="page-container">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Beacon Data</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Every beacon the devices have sent, with the date and time it arrived &mdash; including
              the ticks that reported an empty panel and changed no call.
            </p>
          </div>
          <Link
            href="/reports"
            className="touch-btn border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Back to Reports
          </Link>
        </div>

        <Card className="mb-6 rounded-2xl dark:bg-gray-800 sm:mb-8">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextInput
              placeholder="Search by HID, room or result"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full"
            />
            <Select
              value={hidFilter}
              onChange={(e) => {
                setHidFilter(e.target.value);
                setPage(1);
              }}
              className="w-full"
            >
              <option value="">All devices</option>
              {hidOptions.map((hid) => (
                <option key={hid} value={hid}>
                  HID {hid}
                </option>
              ))}
            </Select>
            <Select
              value={activityFilter}
              onChange={(e) => {
                setActivityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full"
            >
              {ACTIVITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-700 dark:text-white lg:w-auto"
            />
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-700 dark:text-white lg:w-auto"
            />
            <button
              onClick={exportExcel}
              disabled={logs.length === 0}
              className="touch-btn w-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto"
            >
              Export Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={logs.length === 0}
              className="touch-btn w-full bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50 sm:w-auto"
            >
              Export PDF
            </button>
          </div>
        </Card>

        <Card className="dark:bg-gray-800">
          <div className="mb-4 flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Beacon History</h2>
              {!isLoading && !error && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {totalCount === 0
                    ? "No beacons recorded"
                    : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
                  {isRefreshing && (
                    <span className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                      <Spinner size="sm" /> Updating...
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="beacon-rows-per-page"
                className="whitespace-nowrap text-sm text-gray-700 dark:text-gray-300"
              >
                Rows per page:
              </label>
              <Select
                id="beacon-rows-per-page"
                value={pageSizeOption}
                onChange={(e) => handlePageSizeChange(e.target.value)}
                className="min-w-[100px]"
                disabled={isLoading}
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner size="xl" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-red-600 dark:text-red-300">{error}</div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-gray-600 dark:text-gray-300">No beacon data found</div>
          ) : (
            <div
              className={`table-scroll rounded-xl border border-gray-200 dark:border-gray-700 ${
                isRefreshing ? "pointer-events-none opacity-70" : ""
              }`}
            >
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Date &amp; Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">HID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Rooms Reported</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Ringing</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Raised</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Resolved</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Restated</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Unchanged</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                  {logs.map((log, index) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {rangeStart + index}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap font-medium">
                        {formatBeaconTimestamp(log.receivedAt)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{log.hid}</td>
                      <td className="px-4 py-2">
                        {log.rooms.length === 0 ? (
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            Panel clear (no rooms sent)
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {log.rooms.map((room, roomIndex) => (
                              <span
                                key={`${log.id}-${room.deviceNo}-${roomIndex}`}
                                className={`rounded px-2 py-1 text-xs font-semibold ${statusClassName(Number(room.status))}`}
                                title={`${roomLabel(room)} — ${room.statusLabel ?? room.status}`}
                              >
                                {roomLabel(room)}: {room.statusLabel ?? room.status}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{log.ringingCount}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{log.raised}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{log.resolved}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{log.restated}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{log.unchanged}</td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {totalCount === 0
                    ? "No beacons recorded"
                    : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
                </p>
                {showPagination && (
                  <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} showIcons />
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
