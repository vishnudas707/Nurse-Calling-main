"use client";

import { Card, Select, TextInput } from "flowbite-react";
import { matchesScope } from "../../lib/scope";
import type { Scope } from "../../lib/scope";
import Link from "next/link";

type Room = { id: string; roomName: string; hid?: string | null; floor?: number | null };

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
  /** Set in the nav bar; used here only to keep the room list consistent. */
  scope?: Scope;
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
  scope,
  showLagThreshold,
  lagThresholdMinutes,
  setLagThresholdMinutes,
}: ReportFiltersProps) {
  return (
    <Card className="mb-6 rounded-2xl dark:bg-gray-800 sm:mb-8">
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <Link
          href="/reports"
          className="touch-btn border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Back to Reports
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput
          placeholder="Search by Room or Call ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="resolved">Resolved</option>
        </Select>
        <Select value={mutedFilter} onChange={(e) => setMutedFilter(e.target.value)} className="w-full">
          <option value="">All</option>
          <option value="true">Muted</option>
          <option value="false">Unmuted</option>
        </Select>
        <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="w-full">
          <option value="">All Rooms</option>
          {(scope ? rooms.filter((room) => matchesScope(room, scope)) : rooms).map((room) => (
            <option key={room.id} value={room.id}>
              {room.roomName}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-center">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        {showLagThreshold && setLagThresholdMinutes !== undefined && lagThresholdMinutes !== undefined && (
          <>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Attending Lag (min)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={lagThresholdMinutes}
              onChange={(e) => setLagThresholdMinutes(Number(e.target.value))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </>
        )}
      </div>
    </Card>
  );
}
