
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import ScopeBar from "../components/scope-bar";
import { Card } from "flowbite-react";
import { getOrganisationId } from "../lib/auth";
import { getCallTypeName, MISCELLANEOUS_CALL_TYPE } from "../lib/constants";
import { getCallStateLabel, toDayKey, getResolvedStatusClassName, getLocalDayRange } from "../reports/lib/report-utils";
import { describeScope, matchesScope, scopeQuery, useScope, useScopeOptions } from "../lib/scope";
import type { Scope } from "../lib/scope";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

  function DashboardPage() {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";
    const [recentHistory, setRecentHistory] = useState<any[]>([]);
    const [todayHistory, setTodayHistory] = useState<any[]>([]);
    const [activeCalls, setActiveCalls] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [socket, setSocket] = useState<Socket | null>(null);
    const [organisationId, setOrganisationId] = useState<string | null>(null);
    const [organisationName, setOrganisationName] = useState<string | null>(null);
    const [, forceTimeTick] = useState(0);

    // One organisation, two live views. The top pane's scope is the app-wide
    // one - Reports and Settings follow it - while the bottom pane is a second
    // device or floor watched alongside it on the same screen.
    const [primaryScope, setPrimaryScope] = useScope("primary");
    const [secondaryScope, setSecondaryScope] = useScope("secondary");
    const scopeOptions = useScopeOptions();
    const isSplit = scopeOptions.hids.length > 1 || scopeOptions.floors.length > 1;
    const didSeedSecondary = useRef(false);

    // With two devices, a bottom pane defaulted to "All" would just repeat the
    // top one. Seed it with a different device the first time, once.
    useEffect(() => {
      if (didSeedSecondary.current || scopeOptions.isLoading) return;
      didSeedSecondary.current = true;
      if (secondaryScope.value) return;
      const other = scopeOptions.hids.find((hid) => hid !== primaryScope.value);
      if (other) setSecondaryScope({ basis: "hid", value: other });
    }, [scopeOptions, primaryScope.value, secondaryScope.value, setSecondaryScope]);

    const resolveCallFromDashboard = useCallback(async (callId: string) => {
      const orgId = getOrganisationId();
      if (!orgId || !callId) return;
      try {
        const resp = await fetch(`${API_BASE}/api/calls/${callId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: 0, organisationId: orgId, manualResolve: true }),
        });
        if (!resp.ok) {
          console.error("Failed to resolve call", await resp.text());
          return;
        }
        setActiveCalls((prev) => prev.filter((c) => c.id !== callId));
      } catch (err) {
        console.error("Failed to resolve call", err);
      }
    }, [API_BASE]);

    const clearCallFromDashboard = useCallback((callId: string) => {
      void resolveCallFromDashboard(callId);
    }, [resolveCallFromDashboard]);

    // Scoped to the pane it was pressed in, so clearing one device's board
    // never resolves calls the operator cannot see.
    const clearAllVisibleCalls = useCallback((calls: any[]) => {
      for (const call of calls) {
        if (call.id) void resolveCallFromDashboard(call.id);
      }
    }, [resolveCallFromDashboard]);

    function getCallTypeNum(call: { callType?: number | null; status?: number }) {
      if (call.callType != null) return call.callType;
      if (call.status != null && call.status >= 1 && call.status <= 4) return call.status;
      return 1;
    }

    function getCallTheme(callType: unknown, muted: unknown) {
      if (muted === true) {
        return {
          bg: "bg-gray-200 dark:bg-gray-700",
          title: "text-gray-500 dark:text-gray-200",
          sub: "text-gray-500 dark:text-gray-300",
          meta: "text-gray-400 dark:text-gray-400",
          label: "Muted",
        };
      }

      const type = Number(callType);
      if (type === 2) {
        return {
          bg: "bg-red-100 dark:bg-red-900",
          title: "text-red-800 dark:text-red-100",
          sub: "text-red-700 dark:text-red-200",
          meta: "text-red-600 dark:text-red-300",
          label: "Emergency",
        };
      }

      if (type === 4) {
        return {
          bg: "bg-red-100 dark:bg-red-900",
          title: "text-red-800 dark:text-red-100",
          sub: "text-red-700 dark:text-red-200",
          meta: "text-red-600 dark:text-red-300",
          label: "Toilet",
        };
      }

      if (type === 3) {
        return {
          bg: "bg-blue-100 dark:bg-blue-900",
          title: "text-blue-800 dark:text-blue-100",
          sub: "text-blue-700 dark:text-blue-200",
          meta: "text-blue-600 dark:text-blue-300",
          label: "Code Blue",
        };
      }

      // status=1 (normal) is default
      return {
        bg: "bg-green-100 dark:bg-green-900",
        title: "text-green-800 dark:text-green-100",
        sub: "text-green-700 dark:text-green-200",
        meta: "text-green-600 dark:text-green-300",
        label: "Normal",
      };
    }

    function speakText(
      text: string,
      {
        lang = "en-US",
        rate = 1,
        pitch = 1,
        volume = 1,
        voiceName = null
      } = {}
    ) {
      if (!window.speechSynthesis) {
        console.error("Speech synthesis not supported in this browser.");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      // Optional: set voice
      const voices = window.speechSynthesis.getVoices();
      if (voiceName) {
        const selectedVoice = voices.find(v => v.name.includes(voiceName));
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
      }
      window.speechSynthesis.speak(utterance);
    }
  
    // Active calls are fetched for the whole organisation and split here, so a
    // single socket and a single poll feed both panes.
    const topCalls = activeCalls.filter((c) => matchesScope(c, primaryScope));
    const bottomCalls = activeCalls.filter((c) => matchesScope(c, secondaryScope));

    // Dynamic stats - these summarise the top pane, the app-wide scope.
    const now = new Date();
    const todayStr = toDayKey(now);
    const totalCalls = topCalls.length;
    const pendingCalls = topCalls.filter(c => !c.muted).length;
    const resolvedToday = todayHistory.filter((c) => {
      if (!c.dateTimeReset) return false;
      return toDayKey(c.dateTimeReset) === todayStr;
    }).length;
    const responseTimes = todayHistory
      .filter((c) => c.timestamp && c.dateTimeReset && toDayKey(c.dateTimeReset) === todayStr)
      .map(c => (new Date(c.dateTimeReset).getTime() - new Date(c.timestamp).getTime()) / 60000)
      .filter(mins => mins >= 0);
    const avgResponseTime = responseTimes.length ? (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(1) + ' min' : '-';
    const stats = [
      {
        label: "Total Calls",
        value: totalCalls,
        icon: (
          <svg className="h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
          </svg>
        ),
      },
      {
        label: "Pending Calls",
        value: pendingCalls,
        icon: (
          <svg className="h-8 w-8 text-yellow-600" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
          </svg>
        ),
      },
      {
        label: "Resolved Today",
        value: resolvedToday,
        icon: (
          <svg className="h-8 w-8 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
          </svg>
        ),
      },
      {
        label: "Response Time",
        value: avgResponseTime,
        icon: (
          <svg className="h-8 w-8 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.99 5V1h-1v4H8.98c-4.97 0-9 4.05-9 9s4.03 9 9 9 9-4.05 9-9h-1c0 4.41-3.59 8-8 8s-8-3.59-8-8 3.59-8 8-8h3.01V9h1V5zm8.02 12h-6.01V13h-1v5.99h7.01v-1z" />
          </svg>
        ),
      },
    ];

    // History is narrowed on the server: the recent list asks for five rows, so
    // filtering here instead would leave the panel short whenever the newest
    // calls belong to another device.
    const refreshHistoryRef = useRef<() => void>(() => {});

    // The socket handlers below are installed once on mount, so they read the
    // live scopes through a ref rather than a stale closure.
    const scopesRef = useRef<Scope[]>([primaryScope, secondaryScope]);
    scopesRef.current = [primaryScope, secondaryScope];
    /** True when a call belongs to a device or floor this screen is showing. */
    const isOnScreen = (call: { hid?: string | null; floor?: number | null }) =>
      scopesRef.current.some((scope) => matchesScope(call, scope));

    useEffect(() => {
      const orgId = getOrganisationId();
      if (!orgId) return;
      const ac = new AbortController();
      const orgQuery = `?organisationId=${encodeURIComponent(orgId)}${scopeQuery(primaryScope)}`;

      const fetchTodayHistory = async () => {
        const { start: todayStart, end: todayEnd } = getLocalDayRange(new Date());
        try {
          const resp = await fetch(
            `${API_BASE}/api/calls/history${orgQuery}&resetStartDate=${encodeURIComponent(todayStart)}&resetEndDate=${encodeURIComponent(todayEnd)}&status=resolved&page=1&pageSize=10000`,
            { signal: ac.signal }
          );
          const data = await resp.json();
          if (resp.ok && data.success) {
            setTodayHistory((data.data || []).filter((c: { callType?: number }) => c.callType !== MISCELLANEOUS_CALL_TYPE));
          }
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          console.error("Error fetching today history", err);
        }
      };

      const fetchRecentHistory = async () => {
        try {
          const resp = await fetch(`${API_BASE}/api/calls/history${orgQuery}&page=1&pageSize=5`, {
            signal: ac.signal,
          });
          const data = await resp.json();
          if (resp.ok && data.success) {
            setRecentHistory((data.data || []).filter((c: { callType?: number }) => c.callType !== MISCELLANEOUS_CALL_TYPE).slice(0, 5));
          }
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          console.error("Error fetching recent history", err);
        }
      };

      const refresh = () => {
        void fetchRecentHistory();
        void fetchTodayHistory();
      };
      refreshHistoryRef.current = refresh;
      refresh();

      return () => ac.abort();
    }, [API_BASE, primaryScope]);

    useEffect(() => {
      const tickId = window.setInterval(() => {
        forceTimeTick((x) => x + 1);
      }, 30 * 1000);

      const orgId = getOrganisationId();
      setOrganisationId(orgId);
      if (!orgId) {
        setError("Organisation not found. Please log in again.");
        setIsLoading(false);
        return () => {
          window.clearInterval(tickId);
        };
      }
      const orgQuery = `?organisationId=${encodeURIComponent(orgId)}`;

      const fetchOrganisationName = async () => {
        if (!orgId) return;
        try {
          const resp = await fetch(`${API_BASE}/api/organisations/${encodeURIComponent(orgId)}`);
          const data = await resp.json();
          if (resp.ok && data.success && data.data?.name) {
            setOrganisationName(data.data.name);
          }
        } catch (err) {
          console.error("Error fetching organisation name", err);
        }
      };
      fetchOrganisationName();

      const fetchActiveCalls = async () => {
        setIsLoading(true);
        setError("");
        try {
          const resp = await fetch(`${API_BASE}/api/calls/active${orgQuery}`);
          const data = await resp.json();
          if (resp.ok && data.success) {
            setActiveCalls((data.data || []).filter((c: { callType?: number }) => c.callType !== MISCELLANEOUS_CALL_TYPE));
          } else {
            setError(data.error || "Failed to fetch active calls");
          }
        } catch (err) {
          setError("Error connecting to server");
        } finally {
          setIsLoading(false);
        }
      };
      fetchActiveCalls();

      const refreshIntervalId = window.setInterval(() => {
        fetchActiveCalls();
        refreshHistoryRef.current();
      }, 5 * 60 * 1000);
  
      // Setup socket.io client
      const s = io(API_BASE, { transports: ["websocket"] });
      setSocket(s);
  
      if (orgId) {
        sessionStorage.setItem("organisationId", orgId);
        s.emit("joinOrg", orgId);
      }
  
      // Listen for call events with try-catch
      s.on("call:new", (call) => {
        try {
          if (call?.organisationId && call.organisationId !== orgId) return;
          if (call?.callType === MISCELLANEOUS_CALL_TYPE) return;
          console.log('[SocketIO] Received call:new', call);
          // Announce only what this screen is actually showing - a station
          // watching one ward should not be read out another ward's calls. An
          // unscoped pane still matches everything, so the default is unchanged.
          const announce = isOnScreen(call);
          setActiveCalls((prev) => {
            // If call already exists, do nothing; else, add new card
            const exists = prev.find((c) => c.id === call.id);
            if (exists) {
              if (announce) speakText(`Announcement: Repeated call from ${call.roomName}. Please attend.`);
              return prev;
            }
            console.log('calling speakText for new call'+call.roomName);
            if (announce) speakText(`Announcement: New call from ${call.roomName}. Please attend.`);
            return [call, ...prev];
          });
        } catch (err) {
          console.error("Error handling call:new", err);
        }
      });
      s.on("call:muted", ({ id, muted }) => {
        try {
          console.log('[SocketIO] Received call:muted', { id, muted });
          setActiveCalls((prev) => prev.map((c) => c.id === id ? { ...c, muted } : c));
        } catch (err) {
          console.error("Error handling call:muted", err);
        }
      });
      s.on("call:status", ({ id, status }) => {
        try {
          console.log('[SocketIO] Received call:status', { id, status });
          if (status === 0) {
            setActiveCalls((prev) => prev.filter((c) => c.id !== id));
            refreshHistoryRef.current();
          } else {
            setActiveCalls((prev) => prev.map((c) => c.id === id ? { ...c, status, callType: c.callType ?? status } : c));
          }
        } catch (err) {
          console.error("Error handling call:status", err);
        }
      });
  
      return () => {
        window.clearInterval(tickId);
        window.clearInterval(refreshIntervalId);
        s.disconnect();
      };
    }, []);
  
    /**
     * One live board. The dashboard renders it twice - the top pane on the
     * app-wide scope, the bottom pane on its own - so one screen can watch two
     * devices or two floors at once. Both read the same activeCalls state, so
     * there is still a single fetch and a single socket behind them.
     */
    const renderActiveCallsPane = ({
      label,
      calls,
      scope,
      setScope,
      showOrganisation,
      showScopePicker,
    }: {
      label: string;
      calls: any[];
      scope: Scope;
      setScope: (next: Scope) => void;
      showOrganisation: boolean;
      /** Only the bottom pane picks its own scope; the top follows the nav bar. */
      showScopePicker: boolean;
    }) => (
      <div className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
              {isSplit ? `${label} \u2014 ${describeScope(scope)}` : "Active Calls"}
              {!isLoading && !error && (
                <span className="ml-2 text-base font-medium text-gray-500 dark:text-gray-400">
                  ({calls.length} active)
                </span>
              )}
            </h2>
            {showOrganisation && organisationId && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Organisation:{" "}
                <span className="font-medium">
                  {organisationName || organisationId}
                </span>
                {organisationName && (
                  <span className="text-gray-500 dark:text-gray-500"> ({organisationId})</span>
                )}
              </p>
            )}
          </div>
          {!isLoading && !error && calls.length > 0 && (
            <button
              type="button"
              onClick={() => clearAllVisibleCalls(calls)}
              className="touch-btn border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Clear All
            </button>
          )}
        </div>

        {showScopePicker ? (
          <ScopeBar
            scope={scope}
            onChange={setScope}
            options={scopeOptions}
            label={label}
            hint={`${calls.length} active call${calls.length === 1 ? "" : "s"}`}
            compact
          />
        ) : null}

        {/* Active Calls Grid - 6 per row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading ? (
            <div className="col-span-full rounded-2xl border border-dashed border-gray-300 py-10 text-center text-gray-600 dark:border-gray-600 dark:text-gray-300">Loading active calls...</div>
          ) : error ? (
            <div className="col-span-full rounded-2xl border border-red-200 bg-red-50 py-10 text-center text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          ) : calls.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-gray-300 py-10 text-center text-gray-600 dark:border-gray-600 dark:text-gray-300">
              {isSplit ? `No active calls for ${describeScope(scope)}` : "No active calls"}
            </div>
          ) : (
            calls.map((call) => (
              (() => {
                const theme = getCallTheme(getCallTypeNum(call), call.muted);
                return (
              <div
                key={call.id || call.roomId}
                className={`flex flex-col items-center justify-center rounded-2xl p-5 shadow-sm sm:p-6 ${theme.bg}`}
              >
                <p className={`text-3xl font-bold sm:text-4xl ${theme.title}`}>
                  {call.roomName}
                </p>
                <p className={`mt-2 text-sm font-medium ${theme.sub}`}>
                  {theme.label}
                </p>
                {/* The device never sends a floor - this is the one the room is
                    on right now, resolved server-side when the call arrived. */}
                {call.floor ? (
                  <p className={`mt-1 text-xs font-medium ${theme.sub}`}>
                    Floor {call.floor}
                  </p>
                ) : null}
                <p className={`mt-1 text-xs ${theme.meta}`}>
                  {(() => {
                    const mins = call?.timestamp
                      ? Math.floor((Date.now() - new Date(call.timestamp).getTime()) / 60000)
                      : call?.minutesAgo;
                    return mins !== undefined && mins !== null
                      ? `${mins} min${mins === 1 ? "" : "s"} ago`
                      : "";
                  })()}
                </p>
                {/* Mute status UI and toggle */}
                {call.muted !== undefined && (
                  <div className="mt-3 flex w-full flex-col items-center">
                    <p className={`text-xs font-semibold ${call.muted ? 'text-gray-500' : 'text-green-600'}`}>{call.muted ? 'Muted' : 'Unmuted'}</p>
                    <button
                      className={`mt-1.5 min-h-10 w-full max-w-[140px] rounded-xl px-3 py-2 text-sm font-medium border ${call.muted ? 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-gray-700 dark:text-gray-200' : 'bg-green-100 text-green-800 border-green-400 dark:bg-green-900 dark:text-green-200'}`}
                      onClick={async () => {
                        try {
                          const organisationId = getOrganisationId();
                          if (!organisationId) return;
                          const payload = { muted: !call.muted, organisationId };
                          console.log('[MuteButton] Sending PUT', `${API_BASE}/api/calls/${call.id}`, payload);
                          const resp = await fetch(`${API_BASE}/api/calls/${call.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                          });
                          const data = await resp.json();
                          console.log('[MuteButton] Response', data);
                          if (resp.ok) {
                            // Update local state
                            setActiveCalls((prev) => prev.map((c) => c.id === call.id ? { ...c, muted: !call.muted } : c));
                          }
                        } catch (err) {
                          console.error('[MuteButton] Error', err);
                        }
                      }}
                    >
                      {call.muted ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="mt-2 min-h-10 w-full max-w-[140px] rounded-xl border border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                  onClick={() => clearCallFromDashboard(call.id)}
                  title="Resolve call and record reset time in reports"
                >
                  Clear
                </button>
              </div>
                );
              })()
            ))
          )}
        </div>
      </div>
    );

    return (
      <div className="page-shell">
        <TopNavBar />

      <div className="page-container">
          {renderActiveCallsPane({
            label: "Top",
            calls: topCalls,
            scope: primaryScope,
            setScope: setPrimaryScope,
            showOrganisation: true,
            showScopePicker: false,
          })}

          {/* Stats Grid */}
          <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {stats.map((stat) => (
              <Card key={stat.label} className="rounded-2xl dark:bg-gray-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-600 dark:text-gray-400 sm:text-sm">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white sm:mt-2 sm:text-3xl">
                      {stat.value}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-teal-50 p-2.5 dark:bg-gray-700">
                    {stat.icon}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Recent Activity and Quick Actions */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-8">
            {/* Recent Activity */}
            <div className="lg:col-span-2">
              <Card className="rounded-2xl dark:bg-gray-800">
                <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
                    Recent Activity
                  </h2>
                  <a
                    href="/reports"
                    className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                  >
                    View all
                  </a>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  {recentHistory.length === 0 ? (
                    <div className="text-gray-500 dark:text-gray-400">No recent history</div>
                  ) : (
                    recentHistory.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-3 border-b border-gray-200 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 dark:text-white">
                            Call from {item.roomName}
                            {item.floor ? (
                              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                                Floor {item.floor}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {Math.floor((new Date().getTime() - new Date(item.timestamp).getTime()) / (1000 * 60))} minutes ago
                          </p>
                        </div>
                        <div className="space-y-1 sm:text-right">
                          {(() => {
                            const typeNum = getCallTypeNum(item);
                            return (
                              <span
                                className={`mr-2 inline-block rounded-full px-3 py-1 text-xs font-semibold sm:mr-0 ${
                                  typeNum === 2 || typeNum === 4 ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                  : typeNum === 3 ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                  : typeNum === 1 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                  : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                                }`}
                              >
                                {item.callTypeLabel || getCallTypeName(typeNum)}
                              </span>
                            );
                          })()}
                          <span className={getResolvedStatusClassName(item)}>
                            {getCallStateLabel(item)}
                          </span>
                          {item.dateTimeReset ? (
                            <p className="text-xs text-amber-800 dark:text-amber-300">
                              Reset: {new Date(item.dateTimeReset).toLocaleString()}
                            </p>
                          ) : null}
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            {/* Quick Actions */}
            <div>
              <Card className="rounded-2xl dark:bg-gray-800">
                <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white sm:mb-6 sm:text-xl">
                  Quick Actions
                </h2>
                <div className="space-y-3">
                  <a href="/reports" className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-teal-50 px-4 py-3 text-left hover:bg-teal-100 dark:bg-teal-950/50 dark:hover:bg-teal-900/60">
                    <svg
                      className="h-5 w-5 text-teal-700"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                    <span className="font-medium text-gray-900 dark:text-white">
                      View Reports
                    </span>
                  </a>
                  <a href="/settings" className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-left hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50">
                    <svg
                      className="h-5 w-5 text-emerald-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <span className="font-medium text-gray-900 dark:text-white">
                      Settings
                    </span>
                  </a>
                </div>
              </Card>
            </div>
          </div>
      </div>
    </div>
  );
}

export default DashboardPage;
