export type PermissionKind = "read" | "network" | "modify" | "command";
export type PermissionMode = "allow" | "ask" | "deny";

export type PermissionState = Readonly<Record<PermissionKind, PermissionMode>>;

export interface PermissionGate {
  get(): PermissionState;
  assertAvailable(kind: PermissionKind): void;
}

export const defaultPermissionState: PermissionState = {
  read: "allow",
  network: "allow",
  modify: "ask",
  command: "ask",
};
