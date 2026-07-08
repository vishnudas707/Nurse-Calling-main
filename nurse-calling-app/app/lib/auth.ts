export const SUPER_ADMIN_ROLE = "super_admin";

export type StoredUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  organisationId?: string;
  address?: string;
};

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token") || sessionStorage.getItem("auth_token");
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
    if (userStr) return JSON.parse(userStr) as StoredUser;
  } catch {
    // ignore parse errors
  }
  return null;
}

export function getOrganisationId(): string | null {
  const user = getStoredUser();
  if (user?.organisationId) return user.organisationId;
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("organisationId");
}

export function saveUserSession(user: { organisationId?: string }, storage: Storage) {
  storage.setItem("user", JSON.stringify(user));
  if (user.organisationId) {
    sessionStorage.setItem("organisationId", user.organisationId);
  }
}

export function clearUserSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("auth_token");
  localStorage.removeItem("user");
  sessionStorage.removeItem("auth_token");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("organisationId");
}

export function isSuperAdmin(): boolean {
  return getStoredUser()?.role === SUPER_ADMIN_ROLE;
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getPostLoginPath(role?: string): string {
  return role === SUPER_ADMIN_ROLE ? "/super-admin/organisations" : "/dashboard";
}
