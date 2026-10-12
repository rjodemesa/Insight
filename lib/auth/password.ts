import bcrypt from "bcryptjs";

const COST = 12;
export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-z]/i.test(plain) || !/\d/.test(plain)) return "Use at least one letter and one number.";
  return null;
}
