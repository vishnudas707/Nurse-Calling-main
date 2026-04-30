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
