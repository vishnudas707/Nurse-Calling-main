"use client";

import { Card, Select, TextInput } from "flowbite-react";
import Link from "next/link";

type Room = { id: string; roomName: string };

type ReportFiltersProps = {
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  roomFilter: string;
  setRoomFilter: (v: string) => void;
  mutedFilter: string;
  setMutedFilter: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  rooms: Room[];
  showLagThreshold?: boolean;
  lagThresholdMinutes?: number;
  setLagThresholdMinutes?: (v: number) => void;
};

export default function ReportFilters({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  roomFilter,
  setRoomFilter,
  mutedFilter,
  setMutedFilter,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  rooms,
  showLagThreshold,
  lagThresholdMinutes,
  setLagThresholdMinutes,
}: ReportFiltersProps) {
  return (
    <Card className="mb-8 dark:bg-gray-800">
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <Link
          href="/reports"
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Back to Reports
        </Link>
      </div>
      <div className="flex flex-wrap gap-4 items-center">
        <TextInput
          placeholder="Search by Room or Call ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[180px] flex-1"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-w-[140px] flex-1">
          <option value="">All Statuses</option>
          <option value="1">Active</option>
          <option value="0">Resolved</option>
        </Select>
        <Select value={mutedFilter} onChange={(e) => setMutedFilter(e.target.value)} className="min-w-[120px] flex-1">
          <option value="">All</option>
          <option value="true">Muted</option>
          <option value="false">Unmuted</option>
        </Select>
        <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="min-w-[160px] flex-1">
          <option value="">All Rooms</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.roomName}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap gap-4 items-center mt-4">
        <label className="text-gray-700 dark:text-gray-300">Start Date:</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <span className="text-gray-500 dark:text-gray-300">to</span>
        <label className="text-gray-700 dark:text-gray-300">End Date:</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="border rounded px-2 py-1 min-w-[140px] flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        {showLagThreshold && setLagThresholdMinutes !== undefined && lagThresholdMinutes !== undefined && (
          <>
            <label className="text-gray-700 dark:text-gray-300">Attending Lag (min):</label>
            <input
              type="number"
              min={0}
              step={1}
              value={lagThresholdMinutes}
              onChange={(e) => setLagThresholdMinutes(Number(e.target.value))}
              className="border rounded px-2 py-1 w-[140px] dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </>
        )}
      </div>
    </Card>
  );
}
