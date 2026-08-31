
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card } from "flowbite-react";
import { useState, useEffect } from "react";
import { getRoomTypeOptions, getDepartmentTypeOptions, getRoomTypeName, getDepartmentTypeName } from "../lib/constants";
import { getOrganisationId } from "../lib/auth";
import { describeScope, invalidateScopeOptions, matchesScope, useScope } from "../lib/scope";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organisationId: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("rooms");
  const [rooms, setRooms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);

  const [formData, setFormData] = useState({
    roomName: "",
    roomNo_deviceNo: "",
    roomType: "",
    departmentType: "",
    organisationId: "",
    floor: "",
    hid: "",
  });

  // Hardware IDs registered for this organisation by the super admin - the room
  // form picks from these so a room is always tied to a device that exists.
  const [orgHids, setOrgHids] = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editRoomId, setEditRoomId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://20.163.9.187:5001";

  // Fetch user data and rooms on component mount
  useEffect(() => {
    const loadInitialData = async () => {
      // Try to get user from localStorage or sessionStorage
      try {
        const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
        
        if (userStr) {
          const userData = JSON.parse(userStr);
          console.log("Loaded user data:", userData);
          setUser(userData);
          setFormData((prev) => ({
            ...prev,
            organisationId: userData.organisationId || "",
          }));
        } else {
          console.warn("No user data found in storage");
          setError("User data not found. Please log in again.");
        }
      } catch (err) {
        console.error("Error loading user data:", err);
        setError("Error loading user data");
      }
      
      await Promise.all([fetchRooms(), fetchOrganisationHids()]);
    };
    
    loadInitialData();
  }, []);

  const fetchRooms = async () => {
    try {
      setIsLoading(true);
      setError("");
      const orgId = getOrganisationId();
      if (!orgId) {
        setError("Organisation not found. Please log in again.");
        setIsLoading(false);
        return;
      }
      const orgQuery = `?organisationId=${encodeURIComponent(orgId)}`;
      const resp = await fetch(`${API_BASE}/api/rooms${orgQuery}`);
      const data = await resp.json();
      if (resp.ok && data.success) {
        setRooms(data.data);
      } else {
        setError(data.error || "Failed to fetch rooms");
      }
    } catch (err) {
      console.error("Error fetching rooms:", err);
      setError("Error connecting to server");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOrganisationHids = async () => {
    try {
      const orgId = getOrganisationId();
      if (!orgId) return;
      const resp = await fetch(`${API_BASE}/api/organisations/${encodeURIComponent(orgId)}`);
      const data = await resp.json();
      if (!resp.ok || !data.success) return;
      const list: string[] = Array.isArray(data.data?.hids)
        ? data.data.hids.map(String)
        : data.data?.hid != null
          ? [String(data.data.hid)]
          : [];
      const cleaned = list.filter(Boolean);
      setOrgHids(cleaned);
      // One device means there is only one possible answer: fill it in so new
      // rooms are identifiable without the user picking it every time.
      if (cleaned.length === 1) {
        setFormData((prev) => (prev.hid ? prev : { ...prev, hid: cleaned[0] }));
      }
    } catch (err) {
      // Without the list the field falls back to a free-text box, so this is
      // not worth failing the page over.
      console.error("Error fetching organisation HIDs:", err);
    }
  };

  // Set in the nav bar and shared with the Dashboard and Reports, so the
  // device being viewed is the one whose rooms are listed here.
  const [scope] = useScope("primary");
  const scopedRooms = (rooms as any[]).filter((room) => matchesScope(room, scope));

  // Viewing one device and adding a room almost always means adding it to that
  // device, so the form follows the scope until the user picks something else.
  useEffect(() => {
    if (scope.basis !== "hid" || !scope.value) return;
    setFormData((prev) => (prev.hid === scope.value ? prev : { ...prev, hid: scope.value }));
  }, [scope]);

  // A room can hold a HID the organisation no longer lists; keep it in the
  // dropdown so editing the room does not silently drop it.
  const hidOptions =
    formData.hid && !orgHids.includes(formData.hid) ? [...orgHids, formData.hid] : orgHids;

  // Device numbers are per device: every HID has its own r01, r02, ... so the
  // same numbers can be reused on each. Only a repeat within one HID is a
  // clash, so both the hint and the warning below are scoped to the selected
  // HID (rooms with no HID form their own group, matching the server rule).
  const deviceNosOnSelectedHid = (rooms as any[])
    .filter(
      (room) =>
        room.id !== editRoomId &&
        !!room.roomNo_deviceNo &&
        String(room.hid || "") === formData.hid
    )
    .map((room) => String(room.roomNo_deviceNo))
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));

  const deviceNoTaken =
    !!formData.roomNo_deviceNo &&
    deviceNosOnSelectedHid.includes(formData.roomNo_deviceNo.trim());

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Debug log
    console.log("Form data before validation:", formData);

    const missingFields: string[] = [];
    if (!formData.roomName) missingFields.push("Room Name");
    if (!formData.roomType) missingFields.push("Room Type");
    if (!formData.departmentType) missingFields.push("Department Type");
    if (!formData.organisationId) missingFields.push("Organisation ID");
    // A device call is routed by organisation + HID + device number, so a room
    // that shares a device number with another device needs its HID to be
    // reachable. Floor is descriptive only and stays optional.
    if (!formData.hid && orgHids.length > 0) missingFields.push("Hardware ID (HID)");

    if (missingFields.length > 0) {
      const errorMsg = `Missing required fields: ${missingFields.join(", ")}`;
      setError(errorMsg);
      console.log("Validation failed:", missingFields, formData);
      return;
    }

    if (formData.hid && !/^\d{10}$/.test(formData.hid)) {
      setError("Hardware ID (HID) must be a 10-digit number");
      return;
    }

    if (deviceNoTaken) {
      setError(
        `Device No ${formData.roomNo_deviceNo} is already used${
          formData.hid ? ` on HID ${formData.hid}` : " by a room with no HID"
        }. Pick another device number, or assign this room to a different HID.`
      );
      return;
    }

    try {
      const requestBody = {
        organisationId: formData.organisationId,
        roomName: formData.roomName,
        roomNo_deviceNo: formData.roomNo_deviceNo || null,
        roomType: parseInt(formData.roomType),
        departmentType: parseInt(formData.departmentType),
        floor: formData.floor ? parseInt(formData.floor) : null,
        hid: formData.hid || null,
      };
      console.log("Sending request:", requestBody);
      let resp, data;
      if (editRoomId) {
        resp = await fetch(`${API_BASE}/api/rooms/${editRoomId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        data = await resp.json();
      } else {
        resp = await fetch(`${API_BASE}/api/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        data = await resp.json();
      }
      if (!resp.ok) {
        setError(data.error || (editRoomId ? "Failed to update room" : "Failed to add room"));
        return;
      }
      setSuccessMessage(editRoomId ? "Room updated successfully!" : "Room added successfully!");
      setFormData({
        roomName: "",
        roomNo_deviceNo: "",
        roomType: "",
        departmentType: "",
        organisationId: formData.organisationId,
        floor: "",
        // Rooms are added a device at a time - each HID gets its own r01, r02,
        // ... - so keep the HID just used instead of making the admin re-pick
        // it for every room on that device.
        hid: formData.hid || (orgHids.length === 1 ? orgHids[0] : ""),
      });
      setShowForm(false);
      setEditRoomId(null);
      setTimeout(() => setSuccessMessage("") , 3000);
      // A new or removed room can add or retire a floor, so the nav bar's
      // scope list has to be rebuilt.
      invalidateScopeOptions();
      await fetchRooms();
    } catch (err) {
      console.error("Error adding room:", err);
      setError("Error connecting to server");
    }
  };

  const handleEditRoom = (room: any) => {
    setEditRoomId(room.id);
    setShowForm(true);
    setFormData({
      roomName: room.roomName || "",
      roomNo_deviceNo: room.roomNo_deviceNo || "",
      roomType: room.roomType ? String(room.roomType) : "",
      departmentType: room.departmentType ? String(room.departmentType) : "",
      organisationId: room.organisationId || user?.organisationId || "",
      floor: room.floor ? String(room.floor) : "",
      hid: room.hid ? String(room.hid) : "",
    });
  };
  

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm("Are you sure you want to delete this room?")) return;

    try {
      const resp = await fetch(`${API_BASE}/api/rooms/${roomId}`, {
        method: "DELETE",
      });

      const data = await resp.json();

      if (!resp.ok) {
        setError(data.error || "Failed to delete room");
        return;
      }

      setSuccessMessage("Room deleted successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
      // A new or removed room can add or retire a floor, so the nav bar's
      // scope list has to be rebuilt.
      invalidateScopeOptions();
      await fetchRooms();
    } catch (err) {
      console.error("Error deleting room:", err);
      setError("Error connecting to server");
    }
  };
  return (
    <div className="page-shell">
      <TopNavBar />

      <div className="page-container-narrow">
          {/* Tab Navigation */}
          <div className="mb-6 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
            {[
              { id: "rooms", label: "Manage Rooms" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-11 shrink-0 px-4 py-2.5 font-medium transition-colors ${
                  activeTab === tab.id
                    ? "border-b-2 border-teal-700 text-teal-700 dark:text-teal-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Success Message */}
          {successMessage && (
            <div className="mb-4 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-900 dark:text-green-200">
              {successMessage}
            </div>
          )}

          {/* Room Management Tab */}
          {activeTab === "rooms" && (
            <div className="space-y-6">
              {/* Add Room Button */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
                  Rooms
                </h2>
                <button
                  onClick={() => {
                    if (!user) {
                      setError("User data not loaded. Please refresh the page.");
                      return;
                    }
                    if (!showForm && editRoomId) {
                      // Leaving an edit: start the new room clean.
                      setEditRoomId(null);
                      setFormData((prev) => ({
                        ...prev,
                        roomName: "",
                        roomNo_deviceNo: "",
                        roomType: "",
                        departmentType: "",
                        floor: "",
                        hid: orgHids.length === 1 ? orgHids[0] : "",
                      }));
                    }
                    setShowForm(!showForm);
                  }}
                  className="touch-btn w-full bg-teal-700 text-white hover:bg-teal-800 disabled:bg-gray-400 sm:w-auto"
                  disabled={!user}
                >
                  {showForm ? "Cancel" : "+ Add New Room"}
                </button>
              </div>

              {/* Add Room Form */}
              {showForm && (
                <Card className="rounded-2xl dark:bg-gray-800">
                  <form onSubmit={handleAddRoom} className="space-y-6">
                    {error && (
                      <div className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-900 dark:text-red-200">
                        {error}
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                          Room Name *
                        </label>
                        <input
                          type="text"
                          name="roomName"
                          value={formData.roomName}
                          onChange={handleInputChange}
                          placeholder="e.g., ICU Room 201"
                          className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                          Device No
                        </label>
                        <input
                          type="text"
                          name="roomNo_deviceNo"
                          value={formData.roomNo_deviceNo}
                          onChange={handleInputChange}
                          placeholder="e.g., 201 or SIP:201"
                          className={`block w-full rounded-lg border bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${
                            deviceNoTaken
                              ? "border-red-500 dark:border-red-500"
                              : "border-gray-300 dark:border-gray-600"
                          }`}
                        />
                        {deviceNoTaken ? (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                            Device No {formData.roomNo_deviceNo} is already used
                            {formData.hid ? ` on HID ${formData.hid}` : " by a room with no HID"}.
                          </p>
                        ) : deviceNosOnSelectedHid.length > 0 ? (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Already used{formData.hid ? ` on HID ${formData.hid}` : " with no HID"}:{" "}
                            {deviceNosOnSelectedHid.join(", ")}. Each HID has its own device
                            numbers, so the same numbers can be reused on another HID.
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                          Hardware ID (HID){orgHids.length > 0 ? " *" : ""}
                        </label>
                        {hidOptions.length > 0 ? (
                          <select
                            name="hid"
                            value={formData.hid}
                            onChange={handleInputChange}
                            className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            style={{ height: '46px' }}
                            required={orgHids.length > 0}
                          >
                            <option value="">Select a device</option>
                            {hidOptions.map((hid) => (
                              <option key={hid} value={hid}>
                                {hid}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            name="hid"
                            value={formData.hid}
                            onChange={handleInputChange}
                            placeholder="10-digit device ID"
                            inputMode="numeric"
                            maxLength={10}
                            className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          />
                        )}
                      </div>

                      <div>
                                              <div>
                                                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                                                  Floor
                                                </label>
                                                <select
                                                  name="floor"
                                                  value={formData.floor}
                                                  onChange={handleInputChange}
                                                  className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                  style={{ height: '46px' }}
                                                >
                                                  <option value="">Not set</option>
                                                  {[...Array(25)].map((_, i) => (
                                                    <option key={i+1} value={i+1}>{i+1}</option>
                                                  ))}
                                                </select>
                                              </div>
                        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                          Room Type *
                        </label>
                        <select
                          name="roomType"
                          value={formData.roomType}
                          onChange={handleInputChange}
                          className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          style={{ height: '46px' }}
                          required
            
                        >
                          <option value="">Select Type</option>
                          {getRoomTypeOptions().map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                          Department Type *
                        </label>
                        <select
                          name="departmentType"
                          value={formData.departmentType}
                          onChange={handleInputChange}
                          className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          style={{ height: '46px' }}
                          required
                        >
                          <option value="">Select Department</option>
                          {getDepartmentTypeOptions().map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-6 py-2.5 text-white hover:bg-blue-700"
                    >
                      Add Room
                    </button>
                  </form>
                </Card>
              )}

              {/* Rooms List */}
              <Card className="dark:bg-gray-800">
                {isLoading ? (
                  <div className="py-8 text-center text-gray-600 dark:text-gray-400">
                    Loading rooms...
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                        <tr>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Room Name
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Device No
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            HID
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Room Type
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Department
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Floor
                          </th>
                          <th className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {scopedRooms.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-6 py-4 text-center text-gray-600 dark:text-gray-400"
                            >
                              {rooms.length === 0
                                ? "No rooms added yet"
                                : `No rooms for ${describeScope(scope)}`}
                            </td>
                          </tr>
                        ) : (
                          scopedRooms.map((room: any, idx: number) => (
                            <tr
                              key={room.id}
                              className={`border-b border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700 ${
                                idx % 2 === 0
                                  ? "bg-white dark:bg-gray-800"
                                  : "bg-gray-50 dark:bg-gray-900"
                              }`}
                            >
                              
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {room.roomName}
                              </td>
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {room.roomNo_deviceNo || "—"}
                              </td>
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {room.hid || "—"}
                              </td>
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {getRoomTypeName(Number(room.roomType))}
                              </td>
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {getDepartmentTypeName(Number(room.departmentType))}
                              </td>
                              <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                                {room.floor || "—"}
                              </td>
                              <td className="px-6 py-4">
                                <button
                                  onClick={() => handleEditRoom(room)}
                                  className="text-blue-600 hover:underline dark:text-blue-400 mr-4"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteRoom(room.id)}
                                  className="text-red-600 hover:underline dark:text-red-400"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
      </div>
    </div>
  );
}
