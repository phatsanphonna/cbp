import { resolve } from "$app/paths";
import { removeAuthUser } from "@cbp/database/auth-schema";
import {
  listAccessGroupOptions,
  listAccessUsers,
  setAccessUserGroups,
  setAccessUserPermissions,
} from "@cbp/database/access-control";
import { error, fail, redirect } from "@sveltejs/kit";
import { accessPermissions, hasPermission } from "#lib/server/access-control.js";
import { isAdminEmail } from "#lib/server/auth.js";
import { getDatabase } from "#lib/server/database.js";
import { hasTrustedTransport } from "#lib/server/trusted-transport.js";
import type { Actions, PageServerLoad } from "./$types";

const allowedPermissions = new Set<string>(accessPermissions.map(({ key }) => key));

export const load: PageServerLoad = async ({ locals, url }) => {
  const database = getDatabase();
  const canManageUsers = hasPermission(locals.user, "users.manage");
  const canManageGroups = hasPermission(locals.user, "groups.manage");
  const canManagePermissions = hasPermission(locals.user, "permissions.manage");
  const [users, groups] = await Promise.all([
    listAccessUsers(database),
    canManageGroups ? listAccessGroupOptions(database) : Promise.resolve([]),
  ]);
  return {
    users: users.map(({ id, name, email, username, displayUsername, groups, groupIds, directPermissions, permissions }) => {
      const isAdmin = isAdminEmail(email);
      return {
        id,
        name,
        email,
        username: displayUsername ?? username,
        isAdmin,
        isSudo: !isAdmin && permissions.includes("sudo"),
        isCurrentUser: id === locals.auditActor?.id,
        groups,
        groupIds,
        directPermissions,
        permissions: isAdmin ? [] : permissions,
      };
    }),
    groups,
    canManageUsers,
    canManageGroups,
    permissions: canManagePermissions ? accessPermissions : [],
    canManagePermissions,
    created: url.searchParams.get("created") === "1",
    removed: url.searchParams.get("removed") === "1",
  };
};

export const actions: Actions = {
  remove: async (event) => {
    const { request, locals } = event;
    const actorId = locals.auditActor?.id;
    if (!hasPermission(locals.user, "users.manage") || !actorId)
      error(403, "User management permission is required to remove users.");
    if (!hasTrustedTransport(event))
      return fail(403, {
        message: "Use the trusted HTTPS address to remove a user.",
      });
    const id = (await request.formData()).get("userId");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      return fail(400, { message: "Choose a valid user account." });
    }
    locals.auditTargetId = id;
    const result = await removeAuthUser(getDatabase(), actorId, id);
    if (result === "self")
      return fail(400, { message: "You cannot remove your own account." });
    if (result === "missing")
      return fail(404, {
        message: "That user account has already been removed.",
      });
    if (result === "forbidden") error(403, "Your account is no longer active.");
    redirect(303, `${resolve("/users")}?removed=1`);
  },
  assignGroups: async (event) => {
    const { request, locals } = event;
    const actorId = locals.auditActor?.id;
    if (!hasPermission(locals.user, "groups.manage") || !actorId)
      error(403, "Group management permission is required to assign users.");
    if (!hasTrustedTransport(event))
      return fail(403, {
        message: "Use the trusted HTTPS address to manage group membership.",
      });
    const fields = await request.formData();
    const userId = fields.get("userId");
    const submitted = fields.getAll("groupId");
    if (
      typeof userId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      !submitted.every((value) => typeof value === "string" && /^[1-9]\d*$/.test(value))
    ) {
      return fail(400, { message: "Choose a valid user and group list." });
    }
    const groupIds = submitted.map(Number);
    if (
      !groupIds.every((id) => Number.isSafeInteger(id) && id <= 2_147_483_647)
    ) {
      return fail(400, { message: "Choose a valid user and group list." });
    }
    locals.auditTargetId = userId;
    const result = await setAccessUserGroups(getDatabase(), userId, groupIds);
    if (result === "missing")
      return fail(404, { message: "That user account has already been removed." });
    if (result === "invalid-groups")
      return fail(400, { message: "One or more selected groups no longer exist." });
    return { success: "User groups updated." };
  },
  assignPermissions: async (event) => {
    const { request, locals } = event;
    if (!hasPermission(locals.user, "permissions.manage"))
      error(403, "Permission management access is required to assign user permissions.");
    if (!hasTrustedTransport(event))
      return fail(403, {
        message: "Use the trusted HTTPS address to manage user permissions.",
      });
    const fields = await request.formData();
    const userId = fields.get("userId");
    const submitted = fields.getAll("permission");
    if (
      typeof userId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      !submitted.every(
        (value): value is string =>
          typeof value === "string" && allowedPermissions.has(value),
      )
    ) {
      return fail(400, { message: "Choose a valid user and permission list." });
    }
    locals.auditTargetId = userId;
    const database = getDatabase();
    const target = (await listAccessUsers(database)).find(
      (user) => user.id === userId,
    );
    if (!target)
      return fail(404, { message: "That user account has already been removed." });
    if (isAdminEmail(target.email))
      return fail(403, {
        message: "Sudo access for this user is managed by CBP_ADMIN_EMAILS.",
      });
    const result = await setAccessUserPermissions(
      database,
      userId,
      submitted.includes("sudo") ? ["sudo"] : [...new Set(submitted)],
    );
    if (result === "missing")
      return fail(404, { message: "That user account has already been removed." });
    return { success: "User permissions updated." };
  },
};
