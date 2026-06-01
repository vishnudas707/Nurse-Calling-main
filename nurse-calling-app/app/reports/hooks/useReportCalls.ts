"use client";

import { useEffect, useState } from "react";
import { buildHistoryQueryParams, callsHistoryUrl, roomsApiUrl, type CallRecord, type ReportFilterParams } from "../lib/report-utils";

export function useReportCalls(filters: ReportFilterParams) {
  const [allCalls, setAllCalls] = useState<CallRecord[]>([]);
  const [rooms, setRooms] = useState<CallRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const { startDate, endDate, search, statusFilter, roomFilter, mutedFilter } = filters;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError("");
      try {
        const query = buildHistoryQueryParams(filters);
        const [callsResp, roomsResp] = await Promise.all([
          fetch(callsHistoryUrl(query)),
          fetch(roomsApiUrl()),
        ]);
        const callsData = await callsResp.json();
        const roomsData = await roomsResp.json();
        if (callsResp.ok && callsData.success && roomsResp.ok && roomsData.success) {
          setAllCalls(callsData.data || []);
          setRooms(roomsData.data || []);
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
  }, [startDate, endDate, search, statusFilter, roomFilter, mutedFilter]);

  return { allCalls, rooms, isLoading, error };
}
