import { DATABASE_URL } from "$app/env/private";
import { openDatabase } from "@cbp/database";

let database: ReturnType<typeof openDatabase> | undefined;

export function getDatabase() {
  return (database ??= openDatabase(DATABASE_URL));
}
