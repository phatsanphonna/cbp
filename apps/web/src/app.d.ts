declare global {
  namespace App {
    interface Locals {
      user: {
        name: string;
        email: string;
        username?: string | null;
        image?: string | null;
        isAdmin: boolean;
      } | null;
      auditActor?: { id: string; name: string };
      auditTargetId?: string;
    }
  }
}

export {};
