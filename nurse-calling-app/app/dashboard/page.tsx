
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card } from "flowbite-react";
import { it } from "node:test";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";

  function DashboardPage() {
    const [recentHistory, setRecentHistory] = useState<any[]>([]);
    const [activeCalls, setActiveCalls] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [socket, setSocket] = useState<Socket | null>(null);
    const [enabled, setEnabled] = useState(false);

    // Track if speech is unlocked
    const [speechUnlocked, setSpeechUnlocked] = useState(false);
    const speechUnlockedRef = useRef(false);
  
    useEffect(() => {
      speechUnlockedRef.current = speechUnlocked;
    }, [speechUnlocked]);
    
    const toggleVoice = () => {
    if (!enabled) {
      // enable + unlock
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(
          new SpeechSynthesisUtterance("")
        );
      } catch {}
    } else {
      // disable → stop any ongoing speech
      window.speechSynthesis.cancel();
    }

    setEnabled(!enabled);
  };
    // SpeakText function outside useEffect, always uses latest ref
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
      if (!speechUnlockedRef.current) {
        console.warn("Speech synthesis is locked until user interacts with the page.");
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
  
    // Dynamic stats
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const totalCalls = activeCalls.length;
    const pendingCalls = activeCalls.filter(c => c.status === 'Pending' || c.status === 2).length;
    const resolvedToday = activeCalls.filter(c => {
      if (!c.status || !c.timestamp) return false;
      if (c.status === 'Resolved' || c.status === 0) {
        const date = new Date(c.timestamp).toISOString().slice(0, 10);
        return date === todayStr;
      }
      return false;
    }).length;
    // Average response time for resolved calls today (in minutes)
    const responseTimes = activeCalls.filter(c => (c.status === 'Resolved' || c.status === 0) && c.timestamp && c.dateTimeReset)
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
  
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
  
    useEffect(() => {
      // Handler to unlock speech synthesis on first user interaction
      const unlockSpeech = () => {
        setSpeechUnlocked(true);
        // Optionally, play a silent utterance to fully unlock
        try {
          const u = new window.SpeechSynthesisUtterance("");
          window.speechSynthesis.speak(u);
        } catch {}
        window.removeEventListener("click", unlockSpeech);
        window.removeEventListener("keydown", unlockSpeech);
      };
      window.addEventListener("click", unlockSpeech);
      window.addEventListener("keydown", unlockSpeech);
  
      const fetchActiveCalls = async () => {
        setIsLoading(true);
        setError("");
        try {
          const resp = await fetch(`${API_BASE}/api/calls/active`);
          const data = await resp.json();
          if (resp.ok && data.success) {
            setActiveCalls(data.data || []);
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
  
      // Fetch recent history (last 5 calls)
      const fetchRecentHistory = async () => {
        try {
          const resp = await fetch(`${API_BASE}/api/calls/history?limit=5`);
          const data = await resp.json();
          if (resp.ok && data.success) {
            setRecentHistory(data.data.slice(0, 5));
          }
        } catch (err) {
          // Optionally log error
          console.error("Error fetching recent history", err);
        }
      };
      fetchRecentHistory();
  
      // Setup socket.io client
      const s = io(API_BASE, { transports: ["websocket"] });
      setSocket(s);
  
      // Get orgId from user (localStorage/sessionStorage)
      let orgId = 'org_ORG_001'; // Default/fallback
      try {
        const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
        if (userStr) {
          const user = JSON.parse(userStr);
          console.log('[SocketIO] Retrieved user from storage', user);
          orgId = user.organisationId;
          // Save orgId in sessionStorage for later use
          sessionStorage.setItem('organisationId', orgId);
        }
      } catch {}
      console.log('[SocketIO] Joining org room', orgId);
      if (orgId) {
        s.emit("joinOrg", orgId);
      }
  
      // Listen for call events with try-catch
      s.on("call:new", (call) => {
        try {
          console.log('[SocketIO] Received call:new', call);
          setActiveCalls((prev) => {
            // If call already exists, do nothing; else, add new card
            const exists = prev.find((c) => c.id === call.id);
            if (exists) {
              return prev;
            }
            console.log('calling speakText for new call'+call.roomName);
            speakText(`Announcement: New call from ${call.roomName}. Please attend.`);
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
            // Remove card when status is reset
            setActiveCalls((prev) => prev.filter((c) => c.id !== id));
          } else {
            setActiveCalls((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
          }
        } catch (err) {
          console.error("Error handling call:status", err);
        }
      });
  
      return () => {
        s.disconnect();
        window.removeEventListener("click", unlockSpeech);
        window.removeEventListener("keydown", unlockSpeech);
      };
    }, []);
  
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900">
        <TopNavBar />

      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {/* Welcome Section 
          <div className="mb-8">
            {/*<h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              Welcome to Dashboard
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Here's an overview of your nurse calling system performance
            </p>
            
          </div>*/}

          {/* Active Calls Section - Moved to Top */}
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
              Active Calls
            </h2>

            {/* Active Calls Grid - 6 per row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
              {isLoading ? (
                <div className="col-span-6 text-center text-gray-600 dark:text-gray-300 py-8">Loading active calls...</div>
              ) : error ? (
                <div className="col-span-6 text-center text-red-600 dark:text-red-300 py-8">{error}</div>
              ) : activeCalls.length === 0 ? (
                <div className="col-span-6 text-center text-gray-600 dark:text-gray-300 py-8">No active calls</div>
              ) : (
                activeCalls.map((call) => (
                  <div
                    key={call.id || call.roomId}
                    className={`flex flex-col items-center justify-center rounded-lg p-6 ${call.muted ? 'bg-gray-200 dark:bg-gray-700' : 'bg-red-100 dark:bg-red-900'}`}
                  >
                    <p className={`text-4xl font-bold ${call.muted ? 'text-gray-500 dark:text-gray-200' : 'text-red-800 dark:text-red-100'}`}>
                      {call.roomName}
                    </p>
                    <p className={`mt-2 text-sm font-medium ${call.muted ? 'text-gray-500 dark:text-gray-300' : 'text-red-700 dark:text-red-200'}`}>
                      {call.status === 1 ? 'Active' : call.status === 0 ? 'Resolved' : call.status}
                    </p>
                    <p className={`mt-1 text-xs ${call.muted ? 'text-gray-400 dark:text-gray-400' : 'text-red-600 dark:text-red-300'}`}>
                      {call.minutesAgo !== undefined ? `${call.minutesAgo} min${call.minutesAgo === 1 ? '' : 's'} ago` : ''}
                    </p>
                    {/* Mute status UI and toggle */}
                    {call.muted !== undefined && (
                      <div className="mt-2 flex flex-col items-center">
                        <p className={`text-xs font-semibold ${call.muted ? 'text-gray-500' : 'text-green-600'}`}>{call.muted ? 'Muted' : 'Unmuted'}</p>
                        <button
                          className={`mt-1 rounded px-2 py-1 text-xs font-medium border ${call.muted ? 'bg-gray-200 text-gray-700 border-gray-400 dark:bg-gray-700 dark:text-gray-200' : 'bg-green-100 text-green-800 border-green-400 dark:bg-green-900 dark:text-green-200'}`}
                          onClick={async () => {
                            try {
                              // Retrieve organisationId from sessionStorage
                              const organisationId = sessionStorage.getItem('organisationId') || 'org_ORG_001';
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
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <Card key={stat.label} className="dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                      {stat.value}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-100 p-3 dark:bg-gray-700">
                    {stat.icon}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Recent Activity and Quick Actions */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Recent Activity */}
            <div className="lg:col-span-2">
              <Card className="dark:bg-gray-800">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Recent Activity
                  </h2>
                  <a
                    href="/reports"
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View all
                  </a>
                </div>
                <div className="space-y-4">
                  {recentHistory.length === 0 ? (
                    <div className="text-gray-500 dark:text-gray-400">No recent history</div>
                  ) : (
                    recentHistory.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 dark:text-white">
                            Call from {item.roomName}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {Math.floor((new Date().getTime() - new Date(item.timestamp).getTime()) / (1000 * 60))} minutes ago
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                              item.status === "Resolved" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : item.status === "Active" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            }`}
                          >
                            {item.status}
                          </span>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
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
              <Card className="dark:bg-gray-800">
                <h2 className="mb-6 text-xl font-bold text-gray-900 dark:text-white">
                  Quick Actions
                </h2>
                <div className="space-y-3">
                  <a href="/reports" className="flex w-full items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-left hover:bg-blue-100 dark:bg-blue-900 dark:hover:bg-blue-800">
                    <svg
                      className="h-5 w-5 text-blue-600"
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
                  <a href="/settings" className="flex w-full items-center gap-3 rounded-lg bg-green-50 px-4 py-3 text-left hover:bg-green-100 dark:bg-green-900 dark:hover:bg-green-800">
                    <svg
                      className="h-5 w-5 text-green-600"
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
            <button
              onClick={toggleVoice}
              style={{
                padding: "10px 16px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                backgroundColor: enabled ? "#22c55e" : "#ef4444",
                color: "white",
                fontWeight: "bold",
              }}
            >
              {enabled ? "🔊 Voice ON" : "🔇 Voice OFF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
