import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/session";

/**
 * User management for IT officers. New accounts and password resets get a one-time
 * temporary password that must be changed at first sign-in; it is returned once and
 * never stored or logged in plain text. Any change that affects access ends the user's
 * sessions. There must always be at least one active IT officer.
 */
type Conn = Database.Database;

export class UserError extends Error {}

export interface UserRow {
  id: number;
  email: string;
  displayName: string | null;
  role: Role;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignIn: string | null;
  activeSessions: number;
}

const ROLES: Role[] = ["user", "it_officer"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** 16 random characters plus a letter and a digit, so it always meets the password policy. */
export function temporaryPassword(): string {
  return `${crypto.randomBytes(12).toString("base64url")}a7`;
}

export function listUsers(conn: Conn): UserRow[] {
  const rows = conn
    .prepare(
      `SELECT u.id, u.email, u.display_name AS displayName, u.role, u.must_change_password AS mustChange, u.disabled,
         u.created_at AS createdAt, u.updated_at AS updatedAt,
         (SELECT MAX(ts) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS lastSignIn,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS activeSessions
       FROM users u ORDER BY u.disabled, u.role DESC, u.email`,
    )
    .all() as (Omit<UserRow, "mustChangePassword" | "disabled"> & { mustChange: number; disabled: number })[];
  return rows.map(({ mustChange, disabled, ...r }) => ({ ...r, mustChangePassword: mustChange === 1, disabled: disabled === 1 }));
}

const getUser = (conn: Conn, id: number) =>
  conn.prepare("SELECT id, email, role, disabled FROM users WHERE id = ?").get(id) as { id: number; email: string; role: Role; disabled: number } | undefined;

const activeOfficers = (conn: Conn) =>
  conn.prepare("SELECT COUNT(*) FROM users WHERE role = 'it_officer' AND disabled = 0").pluck().get() as number;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function createUser(conn: Conn, body: { email: unknown; displayName: unknown; role: unknown }) {
  const email = clean(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.");
  const role = body.role as Role;
  if (!ROLES.includes(role)) throw new UserError("Role must be user or it_officer.");
  if (conn.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new UserError("An account with that email already exists.");
  const password = temporaryPassword();
  const id = Number(
    conn
      .prepare("INSERT INTO users (email, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)")
      .run(email, clean(body.displayName, 80) || null, await hashPassword(password), role).lastInsertRowid,
  );
  return { id, email, role, temporaryPassword: password };
}

/**
 * Changes role, enabled state or display name. `actorId` cannot lock themselves out,
 * and the last active IT officer cannot be demoted or disabled.
 * Returns what changed and whether sessions must end.
 */
export function updateUser(conn: Conn, actorId: number, id: number, body: { role?: unknown; disabled?: unknown; displayName?: unknown }) {
  const u = getUser(conn, id);
  if (!u) throw new UserError("User not found.");
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  let endSessions = false;
  const run = conn.transaction(() => {
    if (body.role !== undefined) {
      const role = body.role as Role;
      if (!ROLES.includes(role)) throw new UserError("Role must be user or it_officer.");
      if (role !== u.role) {
        if (id === actorId) throw new UserError("You cannot change your own role.");
        if (u.role === "it_officer" && !u.disabled && activeOfficers(conn) <= 1) throw new UserError("Keep at least one active IT officer.");
        conn.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
        changes.role = { from: u.role, to: role };
        endSessions = true;
      }
    }
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== "boolean") throw new UserError("disabled must be true or false.");
      if (body.disabled !== (u.disabled === 1)) {
        if (id === actorId) throw new UserError("You cannot disable your own account.");
        if (body.disabled && u.role === "it_officer" && activeOfficers(conn) <= 1) throw new UserError("Keep at least one active IT officer.");
        conn.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(body.disabled ? 1 : 0, id);
        changes.disabled = { from: u.disabled === 1, to: body.disabled };
        if (body.disabled) endSessions = true;
      }
    }
    if (body.displayName !== undefined) {
      const name = clean(body.displayName, 80) || null;
      conn.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, id);
      changes.displayName = { from: null, to: name };
    }
    if (Object.keys(changes).length) conn.prepare("UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  });
  run();
  if (endSessions) conn.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return { id, email: u.email, changes, endSessions };
}

/** New temporary password, forced change at next sign-in, all sessions ended. */
export async function resetPassword(conn: Conn, actorId: number, id: number) {
  const u = getUser(conn, id);
  if (!u) throw new UserError("User not found.");
  if (id === actorId) throw new UserError("Use Change password for your own account.");
  const password = temporaryPassword();
  conn
    .prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(await hashPassword(password), id);
  conn.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return { id, email: u.email, temporaryPassword: password };
}
