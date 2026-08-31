"use client";

import { useEffect, useState } from "react";
import { useScope } from "../../lib/scope";
import { buildHistoryQueryParams, callsHistoryUrl, fetchRoomsCached, sortCallsForReportTable, type CallRecord, type ReportFilterParams } from "../lib/report-utils";

export function useReportCalls(filters: ReportFilterParams) {
  const [allCalls, setAllCalls] = useState<CallRecord[]>([]);
  const [rooms, setRooms] = useState<CallRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Every summary report inherits the nav bar's device/floor scope, so the
  // three of them and the main report always cover the same set of rooms.
  const [scope] = useScope("primary");

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
        const query = buildHistoryQueryParams({ ...filters, scope });
        const callsResp = await fetch(callsHistoryUrl(query), { signal: ac.signal });
        const callsData = await callsResp.json();
        if (callsResp.ok && callsData.success) {
          setAllCalls(sortCallsForReportTable(callsData.data || []));
        } else {
          setError(callsData.error || "Failed to fetch data");
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (err instanceof Error && err.message === "Organisation ID is required") {
          setError("Organisation not found. Please log in again.");
          return;
        }
        setError("Error connecting to server");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
    return () => ac.abort();
  }, [startDate, endDate, search, statusFilter, roomFilter, mutedFilter, scope]);

  return { allCalls, rooms, isLoading, error, scope };
}
