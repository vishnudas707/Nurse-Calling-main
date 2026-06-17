"use client";

import { useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";

const STATUS_OPTIONS = [
  { value: 0, label: "Reset (0)" },
  { value: 1, label: "Normal (1)" },
  { value: 2, label: "Emergency (2)" },
  { value: 3, label: "Code Blue (3)" },
  { value: 4, label: "Toilet (4)" },
  { value: 5, label: "Miscellaneous (5)" },
] as const;

type RoomRow = { id: string; roomNo: string; status: number };

const DEFAULT_ROOMS: RoomRow[] = [
  { id: "1", roomNo: "1", status: 1 },
  { id: "2", roomNo: "2", status: 2 },
  { id: "3", roomNo: "22", status: 3 },
];

function formatRoomParamKey(roomNo: string): string {
  const digits = roomNo.replace(/\D/g, "") || roomNo;
  return digits.padStart(2, "0");
}

function buildInsertUrl(
  orgId: string,
  hid: string,
  floor: string,
  rooms: RoomRow[]
): string {
  const params = new URLSearchParams({
    orgId,
    hid,
    floor,
  });
  for (const { roomNo, status } of rooms) {
    if (!roomNo.trim()) continue;
    params.set(`r${formatRoomParamKey(roomNo)}`, String(status));
  }
  return `${API_BASE}/api/callstatus/insert?${params.toString()}`;
}

export default function DeviceEmulatorPage() {
  const [orgId, setOrgId] = useState("00001");
  const [floor, setFloor] = useState("1");
  const [hid, setHid] = useState("1234567890");
  const [rooms, setRooms] = useState<RoomRow[]>(DEFAULT_ROOMS);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const previewUrl = useMemo(
    () => buildInsertUrl(orgId, hid, floor, rooms),
    [orgId, hid, floor, rooms]
  );

  const updateRoom = (id: string, field: "roomNo" | "status", value: string | number) => {
    setRooms((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const addRoom = () => {
    setRooms((prev) => [
      ...prev,
      { id: String(Date.now()), roomNo: "", status: 1 },
    ]);
  };

  const removeRoom = (id: string) => {
    setRooms((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  const handleSend = async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch(previewUrl, { method: "GET" });
      const text = (await resp.text()).trim();
      if (resp.ok && text === "SUCCESS") {
        setResult("SUCCESS");
      } else {
        setResult(text === "FAILURE" ? "FAILURE" : `Error: ${resp.status} ${text || resp.statusText}`);
      }
    } catch (err: unknown) {
      setResult("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold mb-2 text-center text-gray-900 dark:text-white">
          Device Emulator
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 text-center">
          URL format: r{"{roomNo}"}=status — room keys are 2-digit zero-padded (e.g. r01, r02, r22)
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">Org ID</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="00001"
            />
          </div>
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">Floor Number</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-gray-700 dark:text-gray-200 mb-1">HID (10 digits)</label>
            <input
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"
              value={hid}
              onChange={(e) => setHid(e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              maxLength={10}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-gray-700 dark:text-gray-200">Rooms</label>
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400"
                onClick={addRoom}
              >
                + Add room
              </button>
            </div>
            <div className="space-y-2">
              {rooms.map((row) => (
                <div key={row.id} className="flex gap-2 items-center">
                  <span className="text-gray-500 dark:text-gray-400 text-sm w-4">r</span>
                  <input
                    className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring"
                    value={row.roomNo}
                    onChange={(e) => updateRoom(row.id, "roomNo", e.target.value)}
                    placeholder="01"
                  />
                  <select
                    className="px-3 py-2 border rounded focus:outline-none focus:ring"
                    value={row.status}
                    onChange={(e) => updateRoom(row.id, "status", Number(e.target.value))}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-red-500 hover:text-red-700 text-sm px-1"
                    onClick={() => removeRoom(row.id)}
                    aria-label="Remove room"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-gray-700 dark:text-gray-200 mb-1 text-sm">Request URL</label>
          <p className="text-xs break-all bg-gray-100 dark:bg-gray-700 p-2 rounded text-gray-800 dark:text-gray-100">
            {previewUrl}
          </p>
        </div>

        <button
          type="button"
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded disabled:opacity-50"
          onClick={handleSend}
          disabled={loading}
        >
          {loading ? "Sending…" : "Send to API"}
        </button>

        {result && (
          <div className="mt-4 p-3 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
