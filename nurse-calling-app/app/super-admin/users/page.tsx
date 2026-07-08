"use client";

import { Card, Spinner, TextInput, Label, Button, Select } from "flowbite-react";
import { useCallback, useEffect, useState } from "react";
import { adminDelete, adminGet, adminPut, normalizeRole } from "../../lib/admin-api";
import AlertMessages from "../components/AlertMessages";
import SuperAdminShell from "../components/SuperAdminShell";
import { AdminUser, emptyUserForm, Organisation, ROLE_OPTIONS } from "../lib/types";

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fetchData = useCallback(async () => {
    setError("");
    const [usersResult, orgsResult] = await Promise.all([
      adminGet<{ success: boolean; data: AdminUser[] }>("/api/admin/users"),
      adminGet<{ success: boolean; data: Organisation[] }>("/api/admin/organisations"),
    ]);

    if (usersResult.status === 401 || usersResult.status === 403) {
      setError(usersResult.error || "Access denied. Super admin login required.");
      return;
    }
    if (!usersResult.ok) {
      setError(usersResult.error || "Failed to load users");
      return;
    }
    if (!orgsResult.ok) {
      setError(orgsResult.error || "Failed to load organisations");
      return;
    }
    setUsers(usersResult.data.data || []);
    setOrganisations(orgsResult.data.data || []);
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchData();
      setIsLoading(false);
    };
    load();
  }, [fetchData]);

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setUserForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setUserForm(emptyUserForm);
    setEditingUserId(null);
  };

  const startEdit = (user: AdminUser) => {
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleUpdate = async (e: React.FormEvent) => {
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
      resetForm();
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(`Delete user "${user.name}" (${user.email || user.id})?`)) return;
    clearMessages();
    setIsSubmitting(true);
    try {
      const result = await adminDelete(`/api/admin/users/${encodeURIComponent(user.id)}`);
      if (!result.ok) {
        setError(result.error || "Failed to delete user");
        return;
      }
      if (editingUserId === user.id) resetForm();
      setSuccessMessage(`User "${user.name}" deleted`);
      await fetchData();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SuperAdminShell title="Users" description="View, edit, and delete user accounts.">
      <div className="space-y-6">
        <AlertMessages error={error} successMessage={successMessage} />

        {editingUserId && (
          <Card className="dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Edit User — {editingUserId}
            </h2>
            <form onSubmit={handleUpdate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="user-name">Name *</Label>
                <TextInput
                  id="user-name"
                  name="name"
                  value={userForm.name}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div>
                <Label htmlFor="user-email">Email</Label>
                <TextInput
                  id="user-email"
                  name="email"
                  type="email"
                  value={userForm.email}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <Label htmlFor="user-role">Role *</Label>
                <Select
                  id="user-role"
                  name="role"
                  value={userForm.role}
                  onChange={handleInputChange}
                  required
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="user-org">Organisation *</Label>
                <Select
                  id="user-org"
                  name="organisationId"
                  value={userForm.organisationId}
                  onChange={handleInputChange}
                  required
                >
                  <option value="">Select organisation</option>
                  {organisations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.id})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="user-address">Address</Label>
                <TextInput
                  id="user-address"
                  name="address"
                  value={userForm.address}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <Label htmlFor="user-password">New Password</Label>
                <TextInput
                  id="user-password"
                  name="password"
                  type="password"
                  value={userForm.password}
                  onChange={handleInputChange}
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" color="blue" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Update User"}
                </Button>
                <Button type="button" color="gray" onClick={resetForm} disabled={isSubmitting}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            All Users ({users.length})
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="xl" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-gray-500 dark:text-gray-400">No users found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Email</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Role</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Organisation</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Org ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Address</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-sm">{user.id}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{user.name}</td>
                      <td className="whitespace-nowrap px-4 py-2">{user.email || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span
                          className={`rounded px-2 py-1 text-xs font-semibold ${
                            user.role === "super_admin"
                              ? "bg-purple-200 text-purple-800"
                              : user.role === "admin"
                                ? "bg-blue-200 text-blue-800"
                                : "bg-gray-200 text-gray-800"
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">{user.organisationName || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-sm">{user.organisationId || "—"}</td>
                      <td className="px-4 py-2">{user.address || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            disabled={isSubmitting}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(user)}
                            className="text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400"
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
    </SuperAdminShell>
  );
}
