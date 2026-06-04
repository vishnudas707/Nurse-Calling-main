"use client";



import { useState } from "react";



const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";



const STATUS_OPTIONS = [

  { value: 0, label: "Reset (0)", color: "bg-gray-600 hover:bg-gray-700" },

  { value: 1, label: "Normal (1)", color: "bg-green-600 hover:bg-green-700" },

  { value: 2, label: "Emergency (2)", color: "bg-red-600 hover:bg-red-700" },

  { value: 3, label: "Code Blue (3)", color: "bg-blue-600 hover:bg-blue-700" },

] as const;



export default function DeviceEmulatorPage() {

  const [orgId, setOrgId] = useState("00001");

  const [floor, setFloor] = useState("2");

  const [roomNo, setRoomNo] = useState("1");

  const [hid, setHid] = useState("1234567890");

  const [result, setResult] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);



  const handleSend = async (callStatus: number) => {

    setLoading(true);

    setResult(null);

    const url = `${API_BASE}/api/callstatus/insert?orgId=${encodeURIComponent(

      orgId

    )}&hid=${encodeURIComponent(hid)}&floor=${encodeURIComponent(

      floor

    )}&r${encodeURIComponent(roomNo)}=${callStatus}`;

    try {

      const resp = await fetch(url, { method: "GET" });

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

      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow p-8">

        <h1 className="text-2xl font-bold mb-6 text-center text-gray-900 dark:text-white">

          Device Emulator

        </h1>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center">

          URL format: r{"{roomNo}"}=status (0 reset, 1 green, 2 red, 3 blue)

        </p>

        <div className="space-y-4">

          <div>

            <label className="block text-gray-700 dark:text-gray-200 mb-1">Org ID</label>

            <input

              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"

              value={orgId}

              onChange={e => setOrgId(e.target.value)}

              placeholder="00001"

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

            <label className="block text-gray-700 dark:text-gray-200 mb-1">Room Number (r value)</label>

            <input

              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"

              value={roomNo}

              onChange={e => setRoomNo(e.target.value)}

              placeholder="1"

            />

          </div>

          <div>

            <label className="block text-gray-700 dark:text-gray-200 mb-1">HID (10 digits)</label>

            <input

              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring"

              value={hid}

              onChange={e => setHid(e.target.value)}

              placeholder="1234567890"

              inputMode="numeric"

              maxLength={10}

            />

          </div>

        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">

          {STATUS_OPTIONS.map((opt) => (

            <button

              key={opt.value}

              type="button"

              className={`${opt.color} text-white font-semibold py-2 rounded disabled:opacity-50 text-sm`}

              onClick={() => handleSend(opt.value)}

              disabled={loading}

            >

              {opt.label}

            </button>

          ))}

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

