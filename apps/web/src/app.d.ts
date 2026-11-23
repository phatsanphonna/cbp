declare global {
  namespace App {
    interface Locals {
      user: { name: string; email: string; username?: string | null; image?: string | null } | null;
    }
  }
}

export {};
