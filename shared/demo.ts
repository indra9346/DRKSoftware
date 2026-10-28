// Demo-mode logins (sample data only), shown on the sign-in page when the server runs in
// demo mode. They exist only in the demo database; a real install never creates them.
export const DEMO_LOGINS = [
  {
    role: "Owner",
    email: "owner@drkfitness.demo",
    password: "Owner@123",
    name: "Demo Owner",
  },
  {
    role: "Front desk",
    email: "desk@drkfitness.demo",
    password: "Desk@123",
    name: "Priya (Front desk)",
  },
  {
    role: "Trainer",
    email: "trainer@drkfitness.demo",
    password: "Trainer@123",
    name: "Kiran (Trainer)",
  },
  {
    role: "Member",
    email: "member@drkfitness.demo",
    password: "Member@123",
    name: "Aarav Sharma",
  },
] as const;

export const isDemoLogin = (email: string) =>
  DEMO_LOGINS.some(login => login.email === email.trim().toLowerCase());
