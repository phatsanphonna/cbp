import { eq, inArray } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { openDatabase } from "./index.js";

export const user = pgTable("cbp_auth_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  username: text().unique(),
  displayUsername: text("display_username"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export async function hasAuthUser(
  database: ReturnType<typeof openDatabase>,
  id: string,
) {
  const [match] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id));
  return Boolean(match);
}

export async function findAuthUserId(
  database: ReturnType<typeof openDatabase>,
  login: string,
) {
  const field = login.includes("@") ? user.email : user.username;
  const [match] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(field, login))
    .limit(1);
  return match?.id;
}

export function listAuthUsers(database: ReturnType<typeof openDatabase>) {
  return database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      displayUsername: user.displayUsername,
    })
    .from(user)
    .orderBy(user.name, user.email);
}

export function removeAuthUser(
  database: ReturnType<typeof openDatabase>,
  actorId: string,
  targetId: string,
) {
  if (actorId === targetId) return Promise.resolve("self" as const);
  return database.transaction(async (tx) => {
    // Lock in a common order so two administrators cannot remove each other.
    const users = await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, [actorId, targetId]))
      .orderBy(user.id)
      .for("update");
    if (!users.some(({ id }) => id === actorId)) return "forbidden";
    if (!users.some(({ id }) => id === targetId)) return "missing";
    await tx.delete(user).where(eq(user.id, targetId));
    return "removed";
  });
}

export const session = pgTable(
  "cbp_auth_session",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("cbp_auth_session_user_idx").on(table.userId)],
);

export const account = pgTable(
  "cbp_auth_account",
  {
    id: text().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("cbp_auth_account_user_idx").on(table.userId)],
);

export const verification = pgTable(
  "cbp_auth_verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("cbp_auth_verification_identifier_idx").on(table.identifier),
  ],
);
