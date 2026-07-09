"use client";

import { useEffect, useState } from "react";
import { buildHistoryQueryParams, callsHistoryUrl, fetchRoomsCached, sortCallsForReportTable, type CallRecord, type ReportFilterParams } from "../lib/report-utils";

export function useReportCalls(filters: ReportFilterParams) {
  const [allCalls, setAllCalls] = useState<CallRecord[]>([]);
  const [rooms, setRooms] = useState<CallRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const { startDate, endDate, search, statusFilter, roomFilter, mutedFilter } = filters;

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
    const fetchData = async () => {
      setIsLoading(true);
      setError("");
      try {
        const query = buildHistoryQueryParams(filters);
        const callsResp = await fetch(callsHistoryUrl(query), { signal: ac.signal });
        const callsData = await callsResp.json();
        if (callsResp.ok && callsData.success) {
          setAllCalls(sortCallsForReportTable(callsData.data || []));
        } else {
          setError("Failed to fetch data");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Error connecting to server");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    return () => ac.abort();
  }, [startDate, endDate, search, statusFilter, roomFilter, mutedFilter]);

  return { allCalls, rooms, isLoading, error };
}
