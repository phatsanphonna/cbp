declare global {
  namespace App {
    interface Error {
      message: string;
    }

    interface Locals {
      user: {
        id: string;
        groupIds: number[];
        name: string;
        email: string;
        username?: string | null;
        image?: string | null;
        isAdmin: boolean;
        permissions: string[];
      } | null;
      auditActor?: { id: string; name: string };
      auditTargetId?: string;
    }
  }
}

export {};
