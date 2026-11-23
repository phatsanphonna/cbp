import { resolve } from "$app/paths";
import { registerHost } from "@cbp/database/inventory";
import { fail, redirect } from "@sveltejs/kit";
import { getDatabase } from "#lib/server/database.js";
import { normalizeHostAddress } from "#lib/server/host-address.js";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fields = await request.formData();
    const value = fields.get("name");
    const name = typeof value === "string" ? value.trim() : "";
    const values = { name: name.slice(0, 253) };
    const address = normalizeHostAddress(name);
    if (!address) {
      return fail(400, { message: "Enter a hostname or IP address.", values });
    }

    const [saved] = await registerHost(getDatabase(), {
      name: address,
      agentManaged: false,
      ansibleManaged: true,
    });
    if (!saved)
      return fail(409, { message: "This host is already registered.", values });
    locals.auditTargetId = saved.id;
    redirect(303, resolve("/hosts"));
  },
};
