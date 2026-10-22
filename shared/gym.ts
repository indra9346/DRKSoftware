export const gymRoles = [
  "owner",
  "admin",
  "receptionist",
  "trainer",
  "member",
  "user",
] as const;
export type GymRole = (typeof gymRoles)[number];

export const roleLabels: Record<GymRole, string> = {
  owner: "Owner",
  admin: "Admin",
  receptionist: "Reception",
  trainer: "Trainer",
  member: "Member",
  user: "Unassigned",
};

export const staffRoles = ["receptionist", "trainer", "member"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const isAdminRole = (role: GymRole | string): boolean =>
  role === "owner" || role === "admin";
export const isFrontDeskRole = (role: GymRole | string): boolean =>
  isAdminRole(role) || role === "receptionist";
