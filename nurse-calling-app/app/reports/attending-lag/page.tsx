"use client";

import TopNavBar from "../../components/navbar";
import { Card, Spinner } from "flowbite-react";
import { useState } from "react";
import ReportFilters from "../components/ReportFilters";
import { useReportCalls } from "../hooks/useReportCalls";
import { exportAttendingLagPdf } from "../lib/export-report-pdf";
import { computeLaggedAttendingCalls } from "../lib/report-utils";

export default function AttendingLagPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [mutedFilter, setMutedFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lagThresholdMinutes, setLagThresholdMinutes] = useState(15);

  const { allCalls, rooms, isLoading, error, scope } = useReportCalls({
    startDate,
    endDate,
    search,
    statusFilter,
    roomFilter,
    mutedFilter,
  });

  const laggedAttendingCalls = computeLaggedAttendingCalls(allCalls, lagThresholdMinutes);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <TopNavBar />
      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Attending Lag</h1>
          <ReportFilters
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            roomFilter={roomFilter}
            setRoomFilter={setRoomFilter}
            mutedFilter={mutedFilter}
            setMutedFilter={setMutedFilter}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            rooms={rooms}
            scope={scope}
            showLagThreshold
            lagThresholdMinutes={lagThresholdMinutes}
            setLagThresholdMinutes={setLagThresholdMinutes}
          />
          <Card className="dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Attending Lag &gt; {lagThresholdMinutes} minutes
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-500 dark:text-gray-300">{laggedAttendingCalls.length} calls</div>
                <button
                  type="button"
                  onClick={() => exportAttendingLagPdf(laggedAttendingCalls, lagThresholdMinutes)}
                  disabled={isLoading || !!error || laggedAttendingCalls.length === 0}
                  className="px-3 py-1 bg-blue-600 text-white rounded min-w-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Download PDF
                </button>
              </div>
            </div>
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <Spinner size="xl" />
              </div>
            ) : error ? (
              <div className="text-center text-red-600 dark:text-red-300 py-8">{error}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Call ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Created</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reset</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Lag (min)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {laggedAttendingCalls.length === 0 ? (
                      <tr>
                        <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300" colSpan={5}>
                          No lagged calls
                        </td>
                      </tr>
                    ) : (
                      laggedAttendingCalls.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-2 whitespace-nowrap">{c.id}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{c.roomName}</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {c.timestamp ? new Date(c.timestamp).toLocaleString() : ""}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {c.dateTimeReset ? new Date(c.dateTimeReset).toLocaleString() : ""}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap font-semibold text-red-700 dark:text-red-300">
                            {c.lagMinutes}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
