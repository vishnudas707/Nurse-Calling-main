
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card, Pagination, Select, TextInput, Spinner } from "flowbite-react";
import { useEffect, useState } from "react";
import { getDepartmentTypeName } from "../lib/constants";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

export default function ReportsPage() {
  const [calls, setCalls] = useState<any[]>([]);
  // Full dataset for summary reports (separate from paginated table)
  const [allCalls, setAllCalls] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [mutedFilter, setMutedFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lagThresholdMinutes, setLagThresholdMinutes] = useState<number>(15);

  // Pagination logic
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError("");
      try {
        const params = [];
        if (startDate) params.push(`startDate=${encodeURIComponent(startDate)}`);
        if (endDate) params.push(`endDate=${encodeURIComponent(endDate)}`);
        if (search) params.push(`search=${encodeURIComponent(search)}`);
        if (statusFilter) params.push(`status=${encodeURIComponent(statusFilter)}`);
        if (roomFilter) params.push(`room=${encodeURIComponent(roomFilter)}`);
        if (mutedFilter) params.push(`muted=${encodeURIComponent(mutedFilter)}`);
        params.push(`page=${page}`);
        params.push(`pageSize=${pageSize}`);
        const callsUrl = `${API_BASE}/api/calls/history${params.length ? "?" + params.join("&") : ""}`;
        // Also fetch a large unpaginated set for summary reports (minimal/additive)
        const summaryParams = [];
        if (startDate) summaryParams.push(`startDate=${encodeURIComponent(startDate)}`);
        if (endDate) summaryParams.push(`endDate=${encodeURIComponent(endDate)}`);
        if (search) summaryParams.push(`search=${encodeURIComponent(search)}`);
        if (statusFilter) summaryParams.push(`status=${encodeURIComponent(statusFilter)}`);
        if (roomFilter) summaryParams.push(`room=${encodeURIComponent(roomFilter)}`);
        if (mutedFilter) summaryParams.push(`muted=${encodeURIComponent(mutedFilter)}`);
        summaryParams.push(`page=1`);
        summaryParams.push(`pageSize=100000`);
        const summaryUrl = `${API_BASE}/api/calls/history${summaryParams.length ? "?" + summaryParams.join("&") : ""}`;

        const [callsResp, summaryResp, roomsResp] = await Promise.all([
          fetch(callsUrl),
          fetch(summaryUrl),
          fetch(`${API_BASE}/api/rooms`),
        ]);
        const callsData = await callsResp.json();
        const summaryData = await summaryResp.json();
        const roomsData = await roomsResp.json();
        if (
          callsResp.ok &&
          callsData.success &&
          summaryResp.ok &&
          summaryData.success &&
          roomsResp.ok &&
          roomsData.success
        ) {
          setCalls(callsData.data || []);
          setAllCalls(summaryData.data || []);
          setRooms(roomsData.data || []);
          setTotalPages(callsData.totalPages || 1);
        } else {
          setError("Failed to fetch data");
        }
      } catch {
        setError("Error connecting to server");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDate, search, statusFilter, roomFilter, mutedFilter, page]);

  // Filtering logic is now handled server-side
  const paginatedCalls = calls;

  const toDayKey = (value: any) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const getLagMinutes = (call: any) => {
    if (!call?.timestamp || !call?.dateTimeReset) return null;
    const start = new Date(call.timestamp).getTime();
    const end = new Date(call.dateTimeReset).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.max(0, Math.floor((end - start) / 60000));
  };

  const callsPerDay = (() => {
    const map = new Map<string, number>();
    for (const c of allCalls) {
      const k = toDayKey(c?.timestamp);
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  })();

  const callsPerRoom = (() => {
    const map = new Map<string, number>();
    for (const c of allCalls) {
      const k = c?.roomName || c?.roomId || "Unknown";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([room, count]) => ({ room, count }))
      .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room));
  })();

  const laggedAttendingCalls = (() => {
    const rows: any[] = [];
    for (const c of allCalls) {
      const lag = getLagMinutes(c);
      if (lag === null) continue;
      if (lag > (Number.isFinite(lagThresholdMinutes) ? lagThresholdMinutes : 15)) {
        rows.push({ ...c, lagMinutes: lag });
      }
    }
    rows.sort((a, b) => (b.lagMinutes || 0) - (a.lagMinutes || 0));
    return rows;
  })();

  // Export to Excel
  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(calls.map(call => ({    
      "Room": call.roomName,
      "Department": getDepartmentTypeName(Number(call.departmentType)),
      "Floor": call.floor || '',
      "Status": call.status === 1 ? "Active" : call.status === 0 ? "Resolved" : call.status,
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

  // Export to PDF
  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text("Call History Report", 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [["Room", "Department", "Floor", "Status", "Muted", "Created", "Muted At", "Reset At", "Repeat Count", "Last Repeat At", "Repeat Duration (min)"]],
      body: calls.map(call => [       
        call.roomName,
        getDepartmentTypeName(Number(call.departmentType)),
        call.floor || '',
        call.status === 1 ? "Active" : call.status === 0 ? "Resolved" : call.status,
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
          {/* Filters */}
          <Card className="mb-8 dark:bg-gray-800">
            <div className="flex flex-wrap gap-4 items-center">
              <TextInput
                placeholder="Search by Room or Call ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[180px] flex-1"
              />
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="min-w-[140px] flex-1">
                <option value="">All Statuses</option>
                <option value="1">Active</option>
                <option value="0">Resolved</option>
                
              </Select>
              <Select value={mutedFilter} onChange={e => setMutedFilter(e.target.value)} className="min-w-[120px] flex-1">
                <option value="">All</option>
                <option value="true">Muted</option>
                <option value="false">Unmuted</option>
              </Select>
              <Select value={roomFilter} onChange={e => setRoomFilter(e.target.value)} className="min-w-[160px] flex-1">
                <option value="">All Rooms</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.roomName}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-4">
              <label className="text-gray-700 dark:text-gray-300">Start Date:</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-2 py-1 min-w-[140px] flex-1" />
              <span className="text-gray-500 dark:text-gray-300">to</span>
              <label className="text-gray-700 dark:text-gray-300">End Date:</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-2 py-1 min-w-[140px] flex-1" />
              <label className="text-gray-700 dark:text-gray-300">Attending Lag (min):</label>
              <input
                type="number"
                min={0}
                step={1}
                value={lagThresholdMinutes}
                onChange={(e) => setLagThresholdMinutes(Number(e.target.value))}
                className="border rounded px-2 py-1 w-[140px]"
              />
              <button onClick={exportExcel} className="px-3 py-1 bg-green-600 text-white rounded min-w-[120px]">Export Excel</button>
              <button onClick={exportPDF} className="px-3 py-1 bg-blue-600 text-white rounded min-w-[120px]">Export PDF</button>
            </div>
          </Card>
          {/* Summary Reports (Calls per day / room / lag > 15 min) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <Card className="dark:bg-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Calls per Day</div>
                <div className="text-sm text-gray-500 dark:text-gray-300">{allCalls.length} calls</div>
              </div>
              {isLoading ? (
                <div className="flex justify-center items-center h-32"><Spinner size="lg" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Count</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {callsPerDay.length === 0 ? (
                        <tr><td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300" colSpan={2}>No data</td></tr>
                      ) : (
                        callsPerDay.map((r) => (
                          <tr key={r.day}>
                            <td className="px-3 py-2 whitespace-nowrap">{r.day}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-semibold">{r.count}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="dark:bg-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Calls per Room</div>
                <div className="text-sm text-gray-500 dark:text-gray-300">Top rooms</div>
              </div>
              {isLoading ? (
                <div className="flex justify-center items-center h-32"><Spinner size="lg" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Count</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {callsPerRoom.length === 0 ? (
                        <tr><td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300" colSpan={2}>No data</td></tr>
                      ) : (
                        callsPerRoom.slice(0, 10).map((r) => (
                          <tr key={r.room}>
                            <td className="px-3 py-2 whitespace-nowrap">{r.room}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-semibold">{r.count}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="dark:bg-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Attending Lag &gt; {lagThresholdMinutes} minutes</div>
                <div className="text-sm text-gray-500 dark:text-gray-300">{laggedAttendingCalls.length} calls</div>
              </div>
              {isLoading ? (
                <div className="flex justify-center items-center h-32"><Spinner size="lg" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Call ID</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reset</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Lag (min)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {laggedAttendingCalls.length === 0 ? (
                        <tr><td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300" colSpan={5}>No lagged calls</td></tr>
                      ) : (
                        laggedAttendingCalls.slice(0, 10).map((c) => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 whitespace-nowrap">{c.id}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.roomName}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.dateTimeReset ? new Date(c.dateTimeReset).toLocaleString() : ""}</td>
                            <td className="px-3 py-2 whitespace-nowrap font-semibold text-red-700 dark:text-red-300">{c.lagMinutes}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {laggedAttendingCalls.length > 10 && (
                    <div className="text-xs text-gray-500 dark:text-gray-300 mt-2">Showing top 10. Use filters/date range to narrow.</div>
                  )}
                </div>
              )}
            </Card>
          </div>
          {/* Reports Table */}
          <Card className="dark:bg-gray-800">
            {isLoading ? (
              <div className="flex justify-center items-center h-64"><Spinner size="xl" /></div>
            ) : error ? (
              <div className="text-center text-red-600 dark:text-red-300 py-8">{error}</div>
            ) : paginatedCalls.length === 0 ? (
              <div className="text-center text-gray-600 dark:text-gray-300 py-8">No call history found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Department</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Floor</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Muted</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Muted At</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reset At</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Repeat Count</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last Repeat At</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Repeat Duration (min)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {paginatedCalls.map((call) => (
                      <tr key={call.id}>
                        <td className="px-4 py-2 whitespace-nowrap">{call.roomName}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getDepartmentTypeName(Number(call.departmentType)) === 'Intensive Care' ? 'bg-red-200 text-red-800' : getDepartmentTypeName(Number(call.departmentType)) === 'General Ward' ? 'bg-blue-200 text-blue-800' : getDepartmentTypeName(Number(call.departmentType)) === 'Emergency' ? 'bg-yellow-200 text-yellow-800' : getDepartmentTypeName(Number(call.departmentType)) === 'Surgery' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>{getDepartmentTypeName(Number(call.departmentType))}</span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{call.floor || ''}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {call.status === 1 ? <span className="text-green-700 font-bold">Active</span> : call.status === 0 ? <span className="text-gray-700 font-bold">Resolved</span> : call.status}
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
                {totalPages > 1 && (
                  <div className="flex justify-center mt-4">
                    <Pagination
                      currentPage={page}
                      totalPages={totalPages}
                      onPageChange={setPage}
                      showIcons
                    />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
