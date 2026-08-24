"use client";

import { Card, Spinner, TextInput, Label, Button } from "flowbite-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminDelete, adminGet, adminPut } from "../../lib/admin-api";
import AlertMessages from "../components/AlertMessages";
import HidListInput from "../components/HidListInput";
import SuperAdminShell from "../components/SuperAdminShell";
import { cleanHids, emptyOrgForm, hidRows, Organisation, orgHids, validateHids } from "../lib/types";

export default function OrganisationsPage() {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [formData, setFormData] = useState(emptyOrgForm);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fetchOrganisations = useCallback(async () => {
    setError("");
    const result = await adminGet<{ success: boolean; data: Organisation[] }>("/api/admin/organisations");
    if (result.status === 401 || result.status === 403) {
      setError(result.error || "Access denied. Super admin login required.");
      return;
    }
    if (!result.ok) {
      setError(result.error || "Failed to load organisations");
      return;
    }
    setOrganisations(result.data.data || []);
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchOrganisations();
      setIsLoading(false);
    };
    load();
  }, [fetchOrganisations]);

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData(emptyOrgForm);
    setEditingOrgId(null);
  };

  const startEdit = (org: Organisation) => {
    clearMessages();
    setEditingOrgId(org.id);
    setFormData({
      id: org.id,
      name: org.name || "",
      address: org.address || "",
      phoneNo: org.phoneNo || "",
      contactPerson: org.contactPerson || "",
      hids: hidRows(org),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!editingOrgId) return;

    if (!formData.name.trim()) {
      setError("Organisation name is required");
      return;
    }
    const hidError = validateHids(formData.hids);
    if (hidError) {
      setError(hidError);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        address: formData.address.trim() || null,
        phoneNo: formData.phoneNo.trim() || null,
        contactPerson: formData.contactPerson.trim() || null,
        hids: cleanHids(formData.hids),
      };
      const result = await adminPut(
        `/api/admin/organisations/${encodeURIComponent(editingOrgId)}`,
        payload
      );
      if (!result.ok) {
        setError(result.error || "Failed to update organisation");
        return;
      }
      setSuccessMessage(`Organisation "${formData.name}" updated successfully`);
      resetForm();
      await fetchOrganisations();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (org: Organisation) => {
    if (!window.confirm(`Delete organisation "${org.name}" (${org.id})?`)) return;
    clearMessages();
    setIsSubmitting(true);
    try {
      const result = await adminDelete(`/api/admin/organisations/${encodeURIComponent(org.id)}`);
      if (!result.ok) {
        setError(result.error || "Failed to delete organisation");
        return;
      }
      if (editingOrgId === org.id) resetForm();
      setSuccessMessage(`Organisation "${org.name}" deleted`);
      await fetchOrganisations();
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SuperAdminShell
      title="Organisations"
      description="View, edit, and delete organisations."
    >
      <div className="space-y-6">
        <AlertMessages error={error} successMessage={successMessage} />

        <div className="flex justify-end">
          <Link
            href="/super-admin/organisations/create"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Create Organisation
          </Link>
        </div>

        {editingOrgId && (
          <Card className="dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              Edit Organisation — {editingOrgId}
            </h2>
            <form onSubmit={handleUpdate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="id">Organisation ID</Label>
                <TextInput id="id" name="id" value={formData.id} disabled />
              </div>
              <div>
                <Label htmlFor="name">Name *</Label>
                <TextInput
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div>
                <Label htmlFor="contactPerson">Contact Person</Label>
                <TextInput
                  id="contactPerson"
                  name="contactPerson"
                  value={formData.contactPerson}
                  onChange={handleInputChange}
                />
              </div>
              <div>
                <Label htmlFor="phoneNo">Phone Number</Label>
                <TextInput
                  id="phoneNo"
                  name="phoneNo"
                  value={formData.phoneNo}
                  onChange={handleInputChange}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <TextInput
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                />
              </div>
              <div className="sm:col-span-2">
                <HidListInput
                  hids={formData.hids}
                  onChange={(hids) => setFormData((prev) => ({ ...prev, hids }))}
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" color="blue" disabled={isSubmitting}>
                  {isSubmitting ? "Saving…" : "Update Organisation"}
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
            All Organisations ({organisations.length})
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner size="xl" />
            </div>
          ) : organisations.length === 0 ? (
            <p className="py-8 text-center text-gray-500 dark:text-gray-400">No organisations found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Contact</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Phone</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Address</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">HIDs</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                  {organisations.map((org) => (
                    <tr key={org.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-sm">{org.id}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{org.name}</td>
                      <td className="whitespace-nowrap px-4 py-2">{org.contactPerson || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2">{org.phoneNo || "—"}</td>
                      <td className="px-4 py-2">{org.address || "—"}</td>
                      <td className="px-4 py-2">
                        {orgHids(org).length === 0 ? (
                          "—"
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {orgHids(org).map((hid) => (
                              <span
                                key={hid}
                                className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                              >
                                {hid}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(org)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            disabled={isSubmitting}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(org)}
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
