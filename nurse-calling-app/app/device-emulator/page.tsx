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

// orgId + hid + device number identify the room; a call carries no floor.
//
// In beacon mode the same URL carries a valueless `beacon` flag and the rooms
// are read as the device's snapshot of what is still ringing rather than as new
// calls - anything the dashboard still has open for this hid and the beacon
// does not list is resolved. The flag is spliced in as a bare `&beacon` (not
// via URLSearchParams, which would write `beacon=`) so the preview matches the
// URL the real panels send.
function buildInsertUrl(orgId: string, hid: string, rooms: RoomRow[], beacon: boolean): string {
  const params = new URLSearchParams({
    orgId,
    hid,
  });
  for (const { roomNo, status } of rooms) {
    if (!roomNo.trim()) continue;
    params.set(`r${formatRoomParamKey(roomNo)}`, String(status));
  }
  const query = params.toString();
  if (!beacon) return `${API_BASE}/api/callstatus/insert?${query}`;
  const [head, ...rest] = query.split(`&r`);
  const roomQuery = rest.length ? `r${rest.join("&r")}` : "";
  return `${API_BASE}/api/callstatus/insert?${head}&beacon&${roomQuery}`;
}

export default function DeviceEmulatorPage() {
  const [orgId, setOrgId] = useState("00001");
  const [hid, setHid] = useState("1234567890");
  const [rooms, setRooms] = useState<RoomRow[]>(DEFAULT_ROOMS);
  const [beacon, setBeacon] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const previewUrl = useMemo(
    () => buildInsertUrl(orgId, hid, rooms, beacon),
    [orgId, hid, rooms, beacon]
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

  // A beacon with no rooms is the device's all-clear, so beacon mode may empty
  // the list; a plain call URL still needs at least one room to be valid.
  const removeRoom = (id: string) => {
    setRooms((prev) => (beacon || prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
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
          URL format: r{"{roomNo}"}=status &mdash; room keys are 2-digit zero-padded (e.g. r01, r02, r22)
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

          <label className="flex items-start gap-2 rounded border border-pink-200 bg-pink-50 p-3 dark:border-pink-900 dark:bg-pink-950/40">
            <input
              type="checkbox"
              className="mt-1"
              checked={beacon}
              onChange={(e) => setBeacon(e.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">
              <span className="font-semibold">Beacon (snapshot)</span>
              <span className="block text-xs text-gray-600 dark:text-gray-400">
                Rooms below are what is still ringing on the device, not new calls. Anything the
                dashboard still shows for this HID and the beacon leaves out (or sends as 0) is
                resolved. Remove every room to send an all-clear beacon.
              </span>
            </span>
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-gray-700 dark:text-gray-200">
                {beacon ? "Rooms still active on device" : "Rooms"}
              </label>
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
                    &times;
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
          {loading ? "Sending..." : "Send to API"}
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
