import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { getAuth } from "#lib/server/auth.js";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  await getAuth().api.signOut({ headers: request.headers });
  redirect(303, resolve("/signin"));
};
