"use client";

import TopNavBar from "../components/navbar";
import { Card, Spinner, TextInput, Label, Button } from "flowbite-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  authHeaders,
  getAuthToken,
  getStoredUser,
  isSuperAdmin,
} from "../lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

type Organisation = {
  id: string;
  name: string;
  address?: string;
  phoneNo?: string;
  contactPerson?: string;
  hid?: string;
};

type AdminUser = {
  id: string;
  name: string;
  email?: string;
  role: string;
  organisationId?: string;
  organisationName?: string;
  address?: string;
};

const emptyOrgForm = {
  id: "",
  name: "",
  address: "",
  phoneNo: "",
  contactPerson: "",
  hid: "",
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [formData, setFormData] = useState(emptyOrgForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fetchData = useCallback(async () => {
    setError("");
    try {
      const headers = {
        "Content-Type": "application/json",
        ...authHeaders(),
      };
      const [orgsResp, usersResp] = await Promise.all([
        fetch(`${API_BASE}/api/admin/organisations`, { headers }),
        fetch(`${API_BASE}/api/admin/users`, { headers }),
      ]);
      const orgsData = await orgsResp.json();
      const usersData = await usersResp.json();

      if (orgsResp.status === 401 || orgsResp.status === 403) {
        setError(orgsData.error || "Access denied. Super admin login required.");
        return;
      }
      if (!orgsResp.ok || !orgsData.success) {
        setError(orgsData.error || "Failed to load organisations");
        return;
      }
      if (!usersResp.ok || !usersData.success) {
        setError(usersData.error || "Failed to load users");
        return;
      }
      setOrganisations(orgsData.data || []);
      setUsers(usersData.data || []);
    } catch {
      setError("Error connecting to server");
    }
  }, []);

  useEffect(() => {
    const user = getStoredUser();
    const token = getAuthToken();
    if (!user || !token || !isSuperAdmin()) {
      router.replace("/login");
      return;
    }
    const load = async () => {
      setIsLoading(true);
      await fetchData();
      setIsLoading(false);
    };
    load();
  }, [router, fetchData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddOrganisation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!formData.id.trim() || !formData.name.trim()) {
      setError("Organisation ID and name are required");
      return;
    }
    if (formData.hid && !/^\d{10}$/.test(formData.hid)) {
      setError("Hardware ID (HID) must be exactly 10 digits");
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/admin/organisations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          id: formData.id.trim(),
          name: formData.name.trim(),
          address: formData.address.trim() || null,
          phoneNo: formData.phoneNo.trim() || null,
          contactPerson: formData.contactPerson.trim() || null,
          hid: formData.hid.trim() || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data.error || "Failed to create organisation");
        return;
      }
      setSuccessMessage(`Organisation "${formData.name}" created successfully`);
      setFormData(emptyOrgForm);
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <TopNavBar />
      <div className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Super Admin</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage organisations and view all users
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900 dark:text-red-200">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900 dark:text-green-200">
              {successMessage}
            </div>
          )}

          <Card className="dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Add Organisation
            </h2>
            <form onSubmit={handleAddOrganisation} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="id" value="Organisation ID *" />
                <TextInput
                  id="id"
                  name="id"
                  value={formData.id}
                  onChange={handleInputChange}
                  placeholder="e.g. 00001"
                  required
                />
              </div>
              <div>
                <Label htmlFor="name" value="Name *" />
                <TextInput
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Hospital name"
                  required
                />
              </div>
              <div>
                <Label htmlFor="contactPerson" value="Contact Person" />
                <TextInput
                  id="contactPerson"
                  name="contactPerson"
                  value={formData.contactPerson}
                  onChange={handleInputChange}
                  placeholder="Contact name"
                />
              </div>
              <div>
                <Label htmlFor="phoneNo" value="Phone Number" />
                <TextInput
                  id="phoneNo"
                  name="phoneNo"
                  value={formData.phoneNo}
                  onChange={handleInputChange}
                  placeholder="Phone number"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="address" value="Address" />
                <TextInput
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  placeholder="Full address"
                />
              </div>
              <div>
                <Label htmlFor="hid" value="Hardware ID (HID)" />
                <TextInput
                  id="hid"
                  name="hid"
                  value={formData.hid}
                  onChange={handleInputChange}
                  placeholder="10-digit device ID"
                  maxLength={10}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" color="blue" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Add Organisation"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Organisations ({organisations.length})
            </h2>
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner size="xl" /></div>
            ) : organisations.length === 0 ? (
              <p className="text-center text-gray-500 dark:text-gray-400 py-8">No organisations found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Contact Person</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Phone</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Address</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">HID</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {organisations.map((org) => (
                      <tr key={org.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-sm">{org.id}</td>
                        <td className="px-4 py-2 whitespace-nowrap font-medium">{org.name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{org.contactPerson || "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{org.phoneNo || "—"}</td>
                        <td className="px-4 py-2">{org.address || "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-sm">{org.hid || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Users ({users.length})
            </h2>
            {isLoading ? (
              <div className="flex justify-center py-12"><Spinner size="xl" /></div>
            ) : users.length === 0 ? (
              <p className="text-center text-gray-500 dark:text-gray-400 py-8">No users found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Role</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Organisation</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Org ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Address</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-sm">{user.id}</td>
                        <td className="px-4 py-2 whitespace-nowrap font-medium">{user.name}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{user.email || "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            user.role === "super_admin"
                              ? "bg-purple-200 text-purple-800"
                              : user.role === "admin"
                                ? "bg-blue-200 text-blue-800"
                                : "bg-gray-200 text-gray-800"
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{user.organisationName || "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap font-mono text-sm">{user.organisationId || "—"}</td>
                        <td className="px-4 py-2">{user.address || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
