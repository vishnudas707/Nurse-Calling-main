"use client";

import { Card, TextInput, Label, Button } from "flowbite-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminPost } from "../../../lib/admin-api";
import AlertMessages from "../../components/AlertMessages";
import SuperAdminShell from "../../components/SuperAdminShell";
import { emptyOrgForm } from "../../lib/types";

export default function CreateOrganisationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState(emptyOrgForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
      const payload = {
        id: formData.id.trim(),
        name: formData.name.trim(),
        address: formData.address.trim() || null,
        phoneNo: formData.phoneNo.trim() || null,
        contactPerson: formData.contactPerson.trim() || null,
        hid: formData.hid.trim() || null,
      };
      const result = await adminPost("/api/admin/organisations", payload);
      if (!result.ok) {
        setError(result.error || "Failed to create organisation");
        return;
      }
      setSuccessMessage(`Organisation "${formData.name}" created successfully`);
      setTimeout(() => router.push("/super-admin/organisations"), 800);
    } catch {
      setError("Error connecting to server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SuperAdminShell
      title="Create Organisation"
      description="Add a new organisation to the system."
    >
      <div className="space-y-6">
        <AlertMessages error={error} successMessage={successMessage} />

        <Card className="max-w-3xl dark:bg-gray-800">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="id">Organisation ID *</Label>
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
              <Label htmlFor="name">Name *</Label>
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
              <Label htmlFor="contactPerson">Contact Person</Label>
              <TextInput
                id="contactPerson"
                name="contactPerson"
                value={formData.contactPerson}
                onChange={handleInputChange}
                placeholder="Contact name"
              />
            </div>
            <div>
              <Label htmlFor="phoneNo">Phone Number</Label>
              <TextInput
                id="phoneNo"
                name="phoneNo"
                value={formData.phoneNo}
                onChange={handleInputChange}
                placeholder="Phone number"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <TextInput
                id="address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="Full address"
              />
            </div>
            <div>
              <Label htmlFor="hid">Hardware ID (HID)</Label>
              <TextInput
                id="hid"
                name="hid"
                value={formData.hid}
                onChange={handleInputChange}
                placeholder="10-digit device ID"
                maxLength={10}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" color="blue" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create Organisation"}
              </Button>
              <Button
                type="button"
                color="gray"
                onClick={() => router.push("/super-admin/organisations")}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </SuperAdminShell>
  );
}
