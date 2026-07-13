
// eslint-disable-next-line @typescript-eslint/no-explicit-any
"use client";

import TopNavBar from "../components/navbar";
import { Card } from "flowbite-react";
import { useState, useEffect } from "react";
import { getRoomTypeOptions, getDepartmentTypeOptions, getRoomTypeName, getDepartmentTypeName } from "../lib/constants";
import { getOrganisationId } from "../lib/auth";

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
  });

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
      
      await fetchRooms();
    };
    
    loadInitialData();
  }, []);

  const fetchRooms = async () => {
    try {
      setIsLoading(true);
      setError("");
      const orgId = getOrganisationId();
      const orgQuery = orgId ? `?organisationId=${encodeURIComponent(orgId)}` : "";
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
    if (!formData.floor) missingFields.push("Floor");

    if (missingFields.length > 0) {
      const errorMsg = `Missing required fields: ${missingFields.join(", ")}`;
      setError(errorMsg);
      console.log("Validation failed:", missingFields, formData);
      return;
    }

    try {
      const requestBody = {
        organisationId: formData.organisationId,
        roomName: formData.roomName,
        roomNo_deviceNo: formData.roomNo_deviceNo || null,
        roomType: parseInt(formData.roomType),
        departmentType: parseInt(formData.departmentType),
        floor: parseInt(formData.floor),
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
        floor: ""
      });
      setShowForm(false);
      setEditRoomId(null);
      setTimeout(() => setSuccessMessage("") , 3000);
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
                          className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      </div>

                      <div>
                                              <div>
                                                <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                                                  Floor *
                                                </label>
                                                <select
                                                  name="floor"
                                                  value={formData.floor}
                                                  onChange={handleInputChange}
                                                  className="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                  style={{ height: '46px' }}
                                                  required
                                                >
                                                  <option value="">Select Floor</option>
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
                        {rooms.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-6 py-4 text-center text-gray-600 dark:text-gray-400"
                            >
                              No rooms added yet
                            </td>
                          </tr>
                        ) : (
                          rooms.map((room: any, idx: number) => (
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
