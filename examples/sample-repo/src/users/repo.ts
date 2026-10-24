export interface User {
  id: number;
  email: string;
  name: string;
  tier: "standard" | "gold";
}

const USERS: User[] = [
  { id: 1, email: "an@example.com", name: "An", tier: "gold" },
  { id: 2, email: "binh@example.com", name: "Binh", tier: "standard" },
];

export function findById(id: number): User | undefined {
  return USERS.find((u) => u.id === id);
}

export function findByEmail(email: string): User | undefined {
  return USERS.find((u) => u.email === email.toLowerCase());
}
