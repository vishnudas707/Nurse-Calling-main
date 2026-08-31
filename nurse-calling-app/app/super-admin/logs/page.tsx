"use client";

import { Card, Spinner, Select, TextInput, Pagination } from "flowbite-react";
import { useCallback, useEffect, useState } from "react";
import { adminGet } from "../../lib/admin-api";
import AlertMessages from "../components/AlertMessages";
import SuperAdminShell from "../components/SuperAdminShell";

type ActivityLog = {
  id: string;
  organisationId?: string;
  organisationName?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  message: string;
  actorId?: string;
  actorName?: string;
  details?: string;
  createdAt: string;
};

type Organisation = { id: string; name: string };

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "auth.login", label: "Login" },
  { value: "organisation.created", label: "Organisation created" },
  { value: "organisation.updated", label: "Organisation updated" },
  { value: "organisation.deleted", label: "Organisation deleted" },
  { value: "user.updated", label: "User updated" },
  { value: "user.deleted", label: "User deleted" },
  { value: "room.created", label: "Room created" },
  { value: "room.updated", label: "Room updated" },
  { value: "room.deleted", label: "Room deleted" },
  { value: "call.created", label: "Call created" },
  { value: "call.repeated", label: "Call repeated" },
  { value: "call.resolved", label: "Call resolved" },
];

const actionBadgeClass = (action: string) => {
  if (action.startsWith("call.")) return "bg-red-100 text-red-800";
  if (action.startsWith("organisation.")) return "bg-purple-100 text-purple-800";
  if (action.startsWith("user.")) return "bg-blue-100 text-blue-800";
  if (action.startsWith("room.")) return "bg-green-100 text-green-800";
  if (action.startsWith("auth.")) return "bg-gray-100 text-gray-800";
  return "bg-gray-100 text-gray-800";
};

export default function SuperAdminLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 50;

  const fetchLogs = useCallback(async () => {
    setError("");
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (orgFilter) params.set("organisationId", orgFilter);
    if (actionFilter) params.set("action", actionFilter);
    if (search) params.set("search", search);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", `${endDate}T23:59:59`);

    const result = await adminGet<{
      success: boolean;
      data: ActivityLog[];
      totalCount: number;
      totalPages: number;
      error?: string;
    }>(`/api/admin/logs?${params.toString()}`);

    if (result.status === 401 || result.status === 403) {
      setError(result.error || "Access denied");
      return;
    }
    if (!result.ok) {
      setError(result.error || "Failed to load logs");
      setLogs([]);
      return;
    }
    setLogs(result.data.data || []);
    setTotalCount(result.data.totalCount ?? 0);
    setTotalPages(result.data.totalPages ?? 1);
  }, [page, orgFilter, actionFilter, search, startDate, endDate]);

  useEffect(() => {
    adminGet<{ success: boolean; data: Organisation[] }>("/api/admin/organisations")
      .then((r) => { if (r.ok) setOrganisations(r.data.data || []); });
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchLogs();
      setIsLoading(false);
    };
    load();
  }, [fetchLogs]);

  return (
    <SuperAdminShell
      title="Activity Log"
      description={"All organisations \u2014 super admin only"}
    >
      <div className="space-y-6">
        <AlertMessages error={error} />

        <Card className="dark:bg-gray-800">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Select value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setPage(1); }}>
                <option value="">All organisations</option>
                {organisations.map((org) => (
                  <option key={org.id} value={org.id}>{org.name} ({org.id})</option>
                ))}
              </Select>
              <Select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
              <TextInput
                placeholder="Search message..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </Card>

          <Card className="dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Events ({totalCount})
              </h2>
            </div>
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner size="xl" /></div>
            ) : logs.length === 0 ? (
              <p className="py-12 text-center text-gray-500 dark:text-gray-400">No log entries found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Time</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Organisation</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Action</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Message</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : "\u2014"}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{log.organisationName || "\u2014"}</div>
                          <div className="text-xs text-gray-500 font-mono">{log.organisationId || ""}</div>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${actionBadgeClass(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 max-w-md">{log.message}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {log.actorName || log.actorId || "\u2014"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="mt-4 flex justify-center">
                    <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} showIcons />
                  </div>
                )}
              </div>
            )}
          </Card>
      </div>
    </SuperAdminShell>
  );
}
