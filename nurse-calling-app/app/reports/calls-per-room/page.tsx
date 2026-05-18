"use client";

import TopNavBar from "../../components/navbar";
import { Card, Spinner } from "flowbite-react";
import { useState } from "react";
import ReportFilters from "../components/ReportFilters";
import { useReportCalls } from "../hooks/useReportCalls";
import { computeCallsPerRoom } from "../lib/report-utils";

export default function CallsPerRoomPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [mutedFilter, setMutedFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { allCalls, rooms, isLoading, error } = useReportCalls({
    startDate,
    endDate,
    search,
    statusFilter,
    roomFilter,
    mutedFilter,
  });

  const callsPerRoom = computeCallsPerRoom(allCalls);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <TopNavBar />
      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Calls per Room</h1>
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
          />
          <Card className="dark:bg-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">Calls by room</div>
              <div className="text-sm text-gray-500 dark:text-gray-300">{allCalls.length} total calls</div>
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
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Room</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Count</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {callsPerRoom.length === 0 ? (
                      <tr>
                        <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300" colSpan={2}>
                          No data
                        </td>
                      </tr>
                    ) : (
                      callsPerRoom.map((r) => (
                        <tr key={r.room}>
                          <td className="px-4 py-2 whitespace-nowrap">{r.room}</td>
                          <td className="px-4 py-2 whitespace-nowrap font-semibold">{r.count}</td>
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
