export function getOrganisationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const userStr = localStorage.getItem("user") || sessionStorage.getItem("user");
    if (userStr) {
      const user = JSON.parse(userStr);
      if (user.organisationId) return user.organisationId;
    }
  } catch {
    // ignore parse errors
  }
  return sessionStorage.getItem("organisationId");
}

export function saveUserSession(user: { organisationId?: string }, storage: Storage) {
  storage.setItem("user", JSON.stringify(user));
  if (user.organisationId) {
    sessionStorage.setItem("organisationId", user.organisationId);
  }
}
