// Room Type Mapping
export const ROOM_TYPE_MAP: { [key: number]: string } = {
  1: "Emergency",
  2: "General",
  3: "ICU",
  4: "Private",
  5: "Isolation",
  6: "Room",
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
  8: "Rooms",
};

// Helper function to get room type name
export const getRoomTypeName = (roomType: number): string => {
  return ROOM_TYPE_MAP[roomType] || `Unknown (${roomType})`;
};

// Helper function to get department type name
export const getDepartmentTypeName = (departmentType: number): string => {
  return DEPARTMENT_TYPE_MAP[departmentType] || `Unknown (${departmentType})`;
};

// Get room type options for form
export const getRoomTypeOptions = () => {
  return Object.entries(ROOM_TYPE_MAP).map(([key, value]) => ({
    value: key,
    label: value,
  }));
};

// Get department type options for form
export const getDepartmentTypeOptions = () => {
  return Object.entries(DEPARTMENT_TYPE_MAP).map(([key, value]) => ({
    value: key,
    label: value,
  }));
};

/** Call type: 1 = Normal, 2 = Emergency, 3 = Code Blue, 4 = Toilet, 5 = Miscellaneous (reports only) */
export const CALL_TYPE_MAP: Record<number, string> = {
  1: "Normal",
  2: "Emergency",
  3: "Code Blue",
  4: "Toilet",
  5: "Miscellaneous",
};

export const MISCELLANEOUS_CALL_TYPE = 5;

export const isMiscellaneousCallType = (callType: number | null | undefined) =>
  Number(callType) === MISCELLANEOUS_CALL_TYPE;

export const getCallTypeName = (callType: number): string =>
  CALL_TYPE_MAP[callType] ?? `Unknown (${callType})`;

export const getCallTypeOptions = () =>
  Object.entries(CALL_TYPE_MAP).map(([key, value]) => ({
    value: key,
    label: value,
  }));
