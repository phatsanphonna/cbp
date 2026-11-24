import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  DATABASE_URL: { schema: (value) => value },
  BETTER_AUTH_URL: { schema: (value) => value },
  BETTER_AUTH_SECRET: { schema: (value) => value },
  CBP_ADMIN_EMAILS: { schema: (value) => value },
  CBP_CONTROLLER_TOKEN: { schema: (value) => value },
  CBP_ANSIBLE_TOKEN: { schema: (value) => value },
  CBP_AGENT_CONTROLLER_ADDRESS: { schema: (value) => value },
  CBP_AGENT_CA_FILE: { schema: (value) => value },
  CBP_AGENT_CA_DOWNLOAD_FILE: { schema: (value) => value },
});
