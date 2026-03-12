/**
 * Sample TypeScript fixture for chunker tests.
 * Contains multiple functions and classes for code-aware chunking tests.
 */

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export function formatUserName(user: UserProfile): string {
  return `${user.name} <${user.email}>`;
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export async function fetchUser(id: string): Promise<UserProfile | null> {
  // Simulate async operation
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!id) return null;
  return {
    id,
    name: 'Test User',
    email: 'test@example.com',
    createdAt: new Date(),
  };
}

export class UserRepository {
  private users: Map<string, UserProfile> = new Map();

  add(user: UserProfile): void {
    this.users.set(user.id, user);
  }

  get(id: string): UserProfile | undefined {
    return this.users.get(id);
  }

  getAll(): UserProfile[] {
    return Array.from(this.users.values());
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }
}

export class AdminUserRepository extends UserRepository {
  private adminIds: Set<string> = new Set();

  setAdmin(id: string): void {
    this.adminIds.add(id);
  }

  isAdmin(id: string): boolean {
    return this.adminIds.has(id);
  }
}
