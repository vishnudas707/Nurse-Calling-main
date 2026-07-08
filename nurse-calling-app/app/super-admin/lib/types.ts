export type Organisation = {
  id: string;
  name: string;
  address?: string;
  phoneNo?: string;
  contactPerson?: string;
  hid?: string;
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

export const emptyOrgForm = {
  id: "",
  name: "",
  address: "",
  phoneNo: "",
  contactPerson: "",
  hid: "",
};

export const emptyUserForm = {
  name: "",
  email: "",
  role: "user",
  organisationId: "",
  address: "",
  password: "",
};
