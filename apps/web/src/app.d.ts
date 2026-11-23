declare global {
  namespace App {
    interface Locals {
      user: { name: string; email: string; username?: string | null; image?: string | null } | null;
      auditActor?: { id: string; name: string };
      auditTargetId?: string;
    }
  }
}

export {};
