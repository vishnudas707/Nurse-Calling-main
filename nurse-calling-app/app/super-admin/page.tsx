"use client";

import TopNavBar from "../components/navbar";
import { Card, Spinner, TextInput, Label, Button, Select } from "flowbite-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAuthToken,
  getStoredUser,
  isSuperAdmin,
} from "../lib/auth";
import {
  adminDelete,
  adminGet,
  adminPost,
  adminPut,
  normalizeRole,
} from "../lib/admin-api";

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

const emptyUserForm = {
  name: "",
  email: "",
  role: "user",
  organisationId: "",
  address: "",
  password: "",
};

const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

export default function SuperAdminPage() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [formData, setFormData] = useState(emptyOrgForm);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fetchData = useCallback(async () => {
    setError("");
    const [orgsResult, usersResult] = await Promise.all([
      adminGet<{ success: boolean; data: Organisation[] }>("/api/admin/organisations"),
      adminGet<{ success: boolean; data: AdminUser[] }>("/api/admin/users"),
    ]);

    if (orgsResult.status === 401 || orgsResult.status === 403) {
      setError(orgsResult.error || "Access denied. Super admin login required.");
      return;
    }
    if (!orgsResult.ok) {
      setError(orgsResult.error || "Failed to load organisations");
      return;
    }
    if (!usersResult.ok) {
      setError(usersResult.error || "Failed to load users");
      return;
    }
    setOrganisations(orgsResult.data.data || []);
    setUsers(usersResult.data.data || []);
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

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  const handleOrgInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleUserInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setUserForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetOrgForm = () => {
    setFormData(emptyOrgForm);
    setEditingOrgId(null);
  };

  const resetUserForm = () => {
    setUserForm(emptyUserForm);
    setEditingUserId(null);
  };

  const startEditOrg = (org: Organisation) => {
    clearMessages();
    setEditingOrgId(org.id);
    setFormData({
      id: org.id,
      name: org.name || "",
      address: org.address || "",
      phoneNo: org.phoneNo || "",
      contactPerson: org.contactPerson || "",
      hid: org.hid || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startEditUser = (user: AdminUser) => {
    clearMessages();
    setEditingUserId(user.id);
    setUserForm({
      name: user.name || "",
      email: user.email || "",
      role: normalizeRole(user.role),
      organisationId: user.organisationId || "",
      address: user.address || "",
      password: "",
    });
  };

  const handleSaveOrganisation = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

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
      const payload = {
        name: formData.name.trim(),
        address: formData.address.trim() || null,
        phoneNo: formData.phoneNo.trim() || null,
        contactPerson: formData.contactPerson.trim() || null,
        hid: formData.hid.trim() || null,
      };
      const isEdit = Boolean(editingOrgId);
      const result = isEdit
        ? await adminPut(`/api/admin/organisations/${encodeURIComponent(editingOrgId!)}`, payload)
        : await adminPost("/api/admin/organisations", { id: formData.id.trim(), ...payload });

      if (!result.ok) {
        setError(result.error || `Failed to ${isEdit ? "update" : "create"} organisation`);
        return;
      }
      setSuccessMessage(`Organisation "${formData.name}" ${isEdit ? "updated" : "created"} successfully`);
      resetOrgForm();
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteOrg = async (org: Organisation) => {
    if (!window.confirm(`Delete organisation "${org.name}" (${org.id})?`)) return;
    clearMessages();
    setIsSubmitting(true);
    try {
      const result = await adminDelete(`/api/admin/organisations/${encodeURIComponent(org.id)}`);
      if (!result.ok) {
        setError(result.error || "Failed to delete organisation");
        return;
      }
      if (editingOrgId === org.id) resetOrgForm();
      setSuccessMessage(`Organisation "${org.name}" deleted`);
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!editingUserId) return;

    if (!userForm.name.trim() || !userForm.role || !userForm.organisationId.trim()) {
      setError("User name, role and organisation are required");
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        name: userForm.name.trim(),
        email: userForm.email.trim() || null,
        role: normalizeRole(userForm.role),
        organisationId: userForm.organisationId.trim(),
        address: userForm.address.trim() || null,
      };
      if (userForm.password.trim()) {
        body.password = userForm.password;
      }
      const result = await adminPut(`/api/admin/users/${encodeURIComponent(editingUserId)}`, body);
      if (!result.ok) {
        setError(result.error || "Failed to update user");
        return;
      }
      setSuccessMessage(`User "${userForm.name}" updated successfully`);
      resetUserForm();
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!window.confirm(`Delete user "${user.name}" (${user.email || user.id})?`)) return;
    clearMessages();
    setIsSubmitting(true);
    try {
      const result = await adminDelete(`/api/admin/users/${encodeURIComponent(user.id)}`);
      if (!result.ok) {
        setError(result.error || "Failed to delete user");
        return;
      }
      if (editingUserId === user.id) resetUserForm();
      setSuccessMessage(`User "${user.name}" deleted`);
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
              Manage organisations and users
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
              {editingOrgId ? `Edit Organisation — ${editingOrgId}` : "Add Organisation"}
            </h2>
            <form onSubmit={handleSaveOrganisation} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="id" value="Organisation ID *" />
                <TextInput
                  id="id"
                  name="id"
                  value={formData.id}
                  onChange={handleOrgInputChange}
                  placeholder="e.g. 00001"
                  required
                  disabled={Boolean(editingOrgId)}
                />
              </div>
              <div>
                <Label htmlFor="name" value="Name *" />
                <TextInput
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleOrgInputChange}
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
                  onChange={handleOrgInputChange}
                  placeholder="Contact name"
                />
              </div>
              <div>
                <Label htmlFor="phoneNo" value="Phone Number" />
                <TextInput
                  id="phoneNo"
                  name="phoneNo"
                  value={formData.phoneNo}
                  onChange={handleOrgInputChange}
                  placeholder="Phone number"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="address" value="Address" />
                <TextInput
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleOrgInputChange}
                  placeholder="Full address"
                />
              </div>
              <div>
                <Label htmlFor="hid" value="Hardware ID (HID)" />
                <TextInput
                  id="hid"
                  name="hid"
                  value={formData.hid}
                  onChange={handleOrgInputChange}
                  placeholder="10-digit device ID"
                  maxLength={10}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" color="blue" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : editingOrgId ? "Update Organisation" : "Add Organisation"}
                </Button>
                {editingOrgId && (
                  <Button type="button" color="gray" onClick={resetOrgForm} disabled={isSubmitting}>
                    Cancel
                  </Button>
                )}
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
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
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
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEditOrg(org)}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm font-medium"
                              disabled={isSubmitting}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteOrg(org)}
                              className="text-red-600 hover:text-red-800 dark:text-red-400 text-sm font-medium"
                              disabled={isSubmitting}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {editingUserId && (
            <Card className="dark:bg-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Edit User — {editingUserId}
              </h2>
              <form onSubmit={handleSaveUser} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="user-name" value="Name *" />
                  <TextInput id="user-name" name="name" value={userForm.name} onChange={handleUserInputChange} required />
                </div>
                <div>
                  <Label htmlFor="user-email" value="Email" />
                  <TextInput id="user-email" name="email" type="email" value={userForm.email} onChange={handleUserInputChange} />
                </div>
                <div>
                  <Label htmlFor="user-role" value="Role *" />
                  <Select id="user-role" name="role" value={userForm.role} onChange={handleUserInputChange} required>
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="user-org" value="Organisation *" />
                  <Select id="user-org" name="organisationId" value={userForm.organisationId} onChange={handleUserInputChange} required>
                    <option value="">Select organisation</option>
                    {organisations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name} ({org.id})</option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="user-address" value="Address" />
                  <TextInput id="user-address" name="address" value={userForm.address} onChange={handleUserInputChange} />
                </div>
                <div>
                  <Label htmlFor="user-password" value="New Password" />
                  <TextInput
                    id="user-password"
                    name="password"
                    type="password"
                    value={userForm.password}
                    onChange={handleUserInputChange}
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button type="submit" color="blue" disabled={isSubmitting}>
                    {isSubmitting ? "Saving…" : "Update User"}
                  </Button>
                  <Button type="button" color="gray" onClick={resetUserForm} disabled={isSubmitting}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          )}

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
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
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
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEditUser(user)}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm font-medium"
                              disabled={isSubmitting}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(user)}
                              className="text-red-600 hover:text-red-800 dark:text-red-400 text-sm font-medium"
                              disabled={isSubmitting}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
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
