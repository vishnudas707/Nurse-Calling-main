
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card, Pagination, Select, TextInput, Spinner } from "flowbite-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getDepartmentTypeName } from "../lib/constants";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { API_BASE } from "./lib/report-utils";

export default function ReportsPage() {
  const [calls, setCalls] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [mutedFilter, setMutedFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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

        const [callsResp, roomsResp] = await Promise.all([
          fetch(callsUrl),
          fetch(`${API_BASE}/api/rooms`),
        ]);
        const callsData = await callsResp.json();
        const roomsData = await roomsResp.json();
        if (callsResp.ok && callsData.success && roomsResp.ok && roomsData.success) {
          setCalls(callsData.data || []);
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

  const paginatedCalls = calls;

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
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <span className="text-gray-500 dark:text-gray-300">to</span>
              <label className="text-gray-700 dark:text-gray-300">End Date:</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 px-1">Call History</h2>
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
