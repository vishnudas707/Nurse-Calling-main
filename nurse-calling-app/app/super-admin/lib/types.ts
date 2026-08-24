export type Organisation = {
  id: string;
  name: string;
  address?: string;
  phoneNo?: string;
  contactPerson?: string;
  /** First HID - kept for older responses that only carry one. */
  hid?: string;
  /** Every hardware ID owned by the organisation. */
  hids?: string[];
};

export type AdminUser = {
  id: string;
  name: string;
  email?: string;
  role: string;
  organisationId?: string;
  organisationName?: string;
  address?: string;
};

export const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
] as const;

export type OrgFormData = {
  id: string;
  name: string;
  address: string;
  phoneNo: string;
  contactPerson: string;
  hids: string[];
};

export const emptyOrgForm: OrgFormData = {
  id: "",
  name: "",
  address: "",
  phoneNo: "",
  contactPerson: "",
  hids: [""],
};

export const emptyUserForm = {
  name: "",
  email: "",
  role: "user",
  organisationId: "",
  address: "",
  password: "",
};

export const HID_PATTERN = /^\d{10}$/;

/** The HIDs an organisation record carries, whichever shape the API returned. */
export const orgHids = (org: Organisation): string[] => {
  if (org.hids?.length) return org.hids.map(String);
  return org.hid ? [String(org.hid)] : [];
};

/** Form rows to submit: trimmed, blank rows dropped, duplicates removed. */
export const cleanHids = (hids: string[]): string[] => {
  const cleaned = hids.map((hid) => hid.trim()).filter(Boolean);
  return Array.from(new Set(cleaned));
};

/** First validation problem in the HID rows, or "" when they are all fine. */
export const validateHids = (hids: string[]): string => {
  const trimmed = hids.map((hid) => hid.trim()).filter(Boolean);
  const invalid = trimmed.find((hid) => !HID_PATTERN.test(hid));
  if (invalid) return `Hardware ID "${invalid}" must be exactly 10 digits`;
  const duplicate = trimmed.find((hid, i) => trimmed.indexOf(hid) !== i);
  if (duplicate) return `Hardware ID ${duplicate} is listed more than once`;
  return "";
};

/** Form rows for an organisation, always leaving one empty row to type into. */
export const hidRows = (org: Organisation): string[] => {
  const hids = orgHids(org);
  return hids.length ? hids : [""];
};
