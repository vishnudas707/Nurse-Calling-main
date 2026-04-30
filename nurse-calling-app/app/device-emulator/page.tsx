"use client";

import { useState } from "react";

export default function DeviceEmulatorPage() {
  const [orgId, setOrgId] = useState("");
  const [floor, setFloor] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [status, setStatus] = useState(-1); // -1 for call, 0 for reset
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSend = async (newStatus: number) => {
    setLoading(true);
    setResult(null);
    const url = `http://localhost:5001/api/callstatus/insert?orgId=${encodeURIComponent(
      orgId
    )}&dnum=${encodeURIComponent(roomNo)}&status=${newStatus}&floor=${encodeURIComponent(
      floor
    )}`;
    try {
      const resp = await fetch(url, { method: "GET" });
      const data = await resp.json().catch(() => ({}));
      setResult(
        resp.ok
          ? `Success: ${JSON.stringify(data)}`
          : `Error: ${resp.status} ${resp.statusText}`
      );
    } catch (err: any) {
      setResult("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-white">
          Device Emulator
        </h1>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">Org ID</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={orgId}
              onChange={e => setOrgId(e.target.value)}
              placeholder="ORG001"
            />
          </div>
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">Floor Number</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={floor}
              onChange={e => setFloor(e.target.value)}
              placeholder="2"
            />
          </div>
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">Room Number</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={roomNo}
              onChange={e => setRoomNo(e.target.value)}
              placeholder="3456"
            />
          </div>
        </div>
        <div className="flex gap-4 mt-6">
          <button
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded disabled:opacity-50"
            onClick={() => handleSend(-1)}
            disabled={loading}
          >
            Call (status -1)
          </button>
          <button
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded disabled:opacity-50"
            onClick={() => handleSend(0)}
            disabled={loading}
          >
            Reset (status 0)
          </button>
        </div>
        {result && (
          <div className="mt-4 p-3 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
