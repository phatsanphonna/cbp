import { saveControllerHeartbeat } from "@cbp/database/controller-status";
import { controllerPost } from "../request.js";

export const POST = controllerPost(async (db) => {
  await saveControllerHeartbeat(db);
  return 204;
});
