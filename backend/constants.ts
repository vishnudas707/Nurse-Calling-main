// Room Type Mapping
export const ROOM_TYPE_MAP: { [key: number]: string } = {
  1: "Emergency",
  2: "General",
  3: "ICU",
  4: "Private",
  5: "Isolation",
};

// Department Type Mapping
export const DEPARTMENT_TYPE_MAP: { [key: number]: string } = {
  1: "Intensive Care",
  2: "General Ward",
  3: "Emergency",
  4: "Pediatrics",
  5: "Surgery",
  6: "Cardiology",
  7: "Neurology",
};

// Helper function to get room type name
export const getRoomTypeName = (roomType: number): string => {
  return ROOM_TYPE_MAP[roomType] || `Unknown (${roomType})`;
};

// Helper function to get department type name
export const getDepartmentTypeName = (departmentType: number): string => {
  return DEPARTMENT_TYPE_MAP[departmentType] || `Unknown (${departmentType})`;
};

/** Device / dashboard call status (permanent color by status, not by refresh time) */
export const CALL_STATUS_MAP: Record<
  number,
  { label: string; color: "gray" | "green" | "red" | "blue" }
> = {
  0: { label: "Reset", color: "gray" },
  1: { label: "Normal", color: "green" },
  2: { label: "Emergency", color: "red" },
  3: { label: "Code Blue", color: "blue" },
  4: { label: "Toilet", color: "red" },
};

export const getCallStatusMeta = (status: number) =>
  CALL_STATUS_MAP[status] ?? { label: `Unknown (${status})`, color: "gray" as const };

export const isValidCallStatus = (status: number) =>
  !Number.isNaN(status) && status >= 0 && status <= 4;

export const withCallStatusFields = <T extends { status: number }>(call: T) => {
  const { label, color } = getCallStatusMeta(call.status);
  return { ...call, statusLabel: label, color };
};

/** Call type stored in CallStatus.callType (1–4 only; 0 = reset has no type) */
export const CALL_TYPE_MAP: Record<number, string> = {
  1: "Normal",
  2: "Emergency",
  3: "Code Blue",
  4: "Toilet",
};

export const getCallTypeName = (callType: number): string =>
  CALL_TYPE_MAP[callType] ?? `Unknown (${callType})`;

export const withCallTypeFields = <T extends { callType?: number | null }>(call: T) => ({
  ...call,
  callTypeLabel: call.callType != null ? getCallTypeName(call.callType) : "",
});
