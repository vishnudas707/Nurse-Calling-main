
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card, Pagination, Select, TextInput, Spinner } from "flowbite-react";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { getDepartmentTypeName, getCallTypeName } from "../lib/constants";
import {
  callsHistoryUrl,
  fetchRoomsCached,
  buildCallsHistoryParams,
  getCallStateLabel,
  isCallActive,
} from "./lib/report-utils";

const PAGE_SIZE_ALL = 100000;
const PAGE_SIZE_OPTIONS = [
  { label: "10", value: "10" },
  { label: "100", value: "100" },
  { label: "500", value: "500" },
  { label: "All", value: "all" },
] as const;

export default function ReportsPage() {
  const [calls, setCalls] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [mutedFilter, setMutedFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [page, setPage] = useState(1);
  const [pageSizeOption, setPageSizeOption] = useState("10");
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const apiPageSize = pageSizeOption === "all" ? PAGE_SIZE_ALL : Number(pageSizeOption);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const ac = new AbortController();
    fetchRoomsCached(ac.signal)
      .then(setRooms)
      .catch((err) => {
        if (err?.name !== "AbortError") console.error("Failed to load rooms", err);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const fetchCalls = async () => {
      if (hasLoadedOnce.current) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError("");
      try {
        const query = buildCallsHistoryParams(
          {
            startDate,
            endDate,
            search: debouncedSearch,
            statusFilter,
            roomFilter,
            mutedFilter,
          },
          page,
          apiPageSize
        );
        const callsResp = await fetch(callsHistoryUrl(query), { signal: ac.signal });
        const callsData = await callsResp.json();
        if (callsResp.ok && callsData.success) {
          setCalls(callsData.data || []);
          setTotalPages(callsData.totalPages || 1);
          setTotalCount(callsData.totalCount ?? (callsData.data?.length || 0));
          hasLoadedOnce.current = true;
        } else {
          setError("Failed to fetch data");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Error connecting to server");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };
    fetchCalls();
    return () => ac.abort();
  }, [startDate, endDate, debouncedSearch, statusFilter, roomFilter, mutedFilter, page, apiPageSize]);

  const paginatedCalls = calls;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * apiPageSize + 1;
  const rangeEnd = Math.min(page * apiPageSize, totalCount);
  const showPagination = pageSizeOption !== "all" && totalPages > 1;

  const handlePageSizeChange = (value: string) => {
    setPageSizeOption(value);
    setPage(1);
  };

  const getCallTypeDisplay = useCallback((call: { callType?: number | null; callTypeLabel?: string; status?: number }) => {
    if (call.callTypeLabel) return call.callTypeLabel;
    if (call.callType != null) return getCallTypeName(call.callType);
    if (call.status != null && call.status >= 1 && call.status <= 5) return getCallTypeName(call.status);
    return "";
  }, []);

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const { saveAs } = await import("file-saver");
    const ws = XLSX.utils.json_to_sheet(calls.map(call => ({
      "Room": call.roomName,
      "Department": getDepartmentTypeName(Number(call.departmentType)),
      "Floor": call.floor || '',
      "Call Type": getCallTypeDisplay(call),
      "Status": getCallStateLabel(call),
      "Muted": call.muted ? "Muted" : "Unmuted",
      "Created": call.timestamp ? new Date(call.timestamp).toLocaleString() : '',
      "Muted At": call.mutedDateTime ? new Date(call.mutedDateTime).toLocaleString() : '',
      "Reset At": call.dateTimeReset ? new Date(call.dateTimeReset).toLocaleString() : '',
      "Repeat Count": call.repeatCount || 0,
      "Last Repeat At": call.lastRepeatAt ? new Date(call.lastRepeatAt).toLocaleString() : '',
      "Repeat Duration (min)": call.repeatDurationMinutes ?? '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CallHistory");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([buf], { type: "application/octet-stream" }), "call_history.xlsx");
  };

  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.text("Call History Report", 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [["Room", "Department", "Floor", "Call Type", "Status", "Muted", "Created", "Muted At", "Reset At", "Repeat Count", "Last Repeat At", "Repeat Duration (min)"]],
      body: calls.map(call => [
        call.roomName,
        getDepartmentTypeName(Number(call.departmentType)),
        call.floor || '',
        getCallTypeDisplay(call),
        getCallStateLabel(call),
        call.muted ? "Muted" : "Unmuted",
        call.timestamp ? new Date(call.timestamp).toLocaleString() : '',
        call.mutedDateTime ? new Date(call.mutedDateTime).toLocaleString() : '',
        call.dateTimeReset ? new Date(call.dateTimeReset).toLocaleString() : '',
        call.repeatCount || 0,
        call.lastRepeatAt ? new Date(call.lastRepeatAt).toLocaleString() : '',
        call.repeatDurationMinutes ?? '',
      ]),
    });
    doc.save("call_history.pdf");
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <TopNavBar />
      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Card className="mb-8 dark:bg-gray-800">
            <div className="flex flex-wrap gap-4 items-center">
              <TextInput
                placeholder="Search by Room or Call ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[180px] flex-1"
              />
              <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="min-w-[140px] flex-1">
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="resolved">Resolved</option>
              </Select>
              <Select value={mutedFilter} onChange={e => { setMutedFilter(e.target.value); setPage(1); }} className="min-w-[120px] flex-1">
                <option value="">All</option>
                <option value="true">Muted</option>
                <option value="false">Unmuted</option>
              </Select>
              <Select value={roomFilter} onChange={e => { setRoomFilter(e.target.value); setPage(1); }} className="min-w-[160px] flex-1">
                <option value="">All Rooms</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.roomName}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-4">
              <label className="text-gray-700 dark:text-gray-300">Start Date:</label>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <span className="text-gray-500 dark:text-gray-300">to</span>
              <label className="text-gray-700 dark:text-gray-300">End Date:</label>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <button onClick={exportExcel} className="px-3 py-1 bg-green-600 text-white rounded min-w-[120px]">Export Excel</button>
              <button onClick={exportPDF} className="px-3 py-1 bg-blue-600 text-white rounded min-w-[120px]">Export PDF</button>
            </div>
          </Card>

          <Card className="mb-8 dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Summary Reports</h2>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/reports/calls-per-day"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-center min-w-[160px]"
              >
                Calls per Day
              </Link>
              <Link
                href="/reports/calls-per-room"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-center min-w-[160px]"
              >
                Calls per Room
              </Link>
              <Link
                href="/reports/attending-lag"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-center min-w-[160px]"
              >
                Attending Lag
              </Link>
            </div>
          </Card>

          <Card className="dark:bg-gray-800">
            <div className="flex flex-col gap-4 mb-4 px-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Call History</h2>
                {!isLoading && !error && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {totalCount === 0
                      ? "No records"
                      : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
                    {isRefreshing && (
                      <span className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <Spinner size="sm" /> Updating…
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="rows-per-page" className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  Rows per page:
                </label>
                <Select
                  id="rows-per-page"
                  value={pageSizeOption}
                  onChange={(e) => handlePageSizeChange(e.target.value)}
                  className="min-w-[100px]"
                  disabled={isLoading}
                >
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center items-center h-64"><Spinner size="xl" /></div>
            ) : error ? (
              <div className="text-center text-red-600 dark:text-red-300 py-8">{error}</div>
            ) : paginatedCalls.length === 0 ? (
              <div className="text-center text-gray-600 dark:text-gray-300 py-8">No call history found</div>
            ) : (
              <div className={`overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 ${isRefreshing ? "opacity-70 pointer-events-none" : ""}`}>
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Floor</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Call Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Muted</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Muted At</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reset At</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Repeat Count</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last Repeat At</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Repeat Duration (min)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {paginatedCalls.map((call, index) => (
                      <tr key={call.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{rangeStart + index}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.roomName}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getDepartmentTypeName(Number(call.departmentType)) === 'Intensive Care' ? 'bg-red-200 text-red-800' : getDepartmentTypeName(Number(call.departmentType)) === 'General Ward' ? 'bg-blue-200 text-blue-800' : getDepartmentTypeName(Number(call.departmentType)) === 'Emergency' ? 'bg-yellow-200 text-yellow-800' : getDepartmentTypeName(Number(call.departmentType)) === 'Surgery' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>{getDepartmentTypeName(Number(call.departmentType))}</span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.floor || ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {(() => {
                            const typeNum = call.callType ?? (call.status >= 1 && call.status <= 5 ? call.status : null);
                            return (
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                typeNum === 2 || typeNum === 4 ? "bg-red-200 text-red-800"
                                : typeNum === 3 ? "bg-blue-200 text-blue-800"
                                : typeNum === 1 ? "bg-green-200 text-green-800"
                                : typeNum === 5 ? "bg-purple-200 text-purple-800"
                                : "bg-gray-200 text-gray-800"
                              }`}>{getCallTypeDisplay(call)}</span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {isCallActive(call)
                            ? <span className="text-green-700 font-bold">Active</span>
                            : <span className="text-gray-700 font-bold">Resolved</span>}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.muted ? 'Muted' : 'Unmuted'}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.timestamp ? new Date(call.timestamp).toLocaleString() : ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.mutedDateTime ? new Date(call.mutedDateTime).toLocaleString() : ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.dateTimeReset ? new Date(call.dateTimeReset).toLocaleString() : ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.repeatCount || 0}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.lastRepeatAt ? new Date(call.lastRepeatAt).toLocaleString() : ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.repeatDurationMinutes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {totalCount === 0
                      ? "No records"
                      : `Showing ${rangeStart}–${rangeEnd} of ${totalCount}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label htmlFor="rows-per-page-footer" className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        Rows per page:
                      </label>
                      <Select
                        id="rows-per-page-footer"
                        value={pageSizeOption}
                        onChange={(e) => handlePageSizeChange(e.target.value)}
                        className="min-w-[100px]"
                      >
                        {PAGE_SIZE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>
                    </div>
                    {showPagination && (
                      <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        showIcons
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
