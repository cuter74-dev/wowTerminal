// Rust 측 SshHost / SshAuthMethod 와 일치.

export type SshAuthMethod =
  | { type: "password"; secret_id: string }
  | { type: "private_key"; key_id: string; passphrase_secret_id: string | null }
  | { type: "agent" };

export interface SshHost {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuthMethod;
  tags: string[];
}

export type TerminalSource =
  | { kind: "local" }
  | { kind: "ssh"; hostId: string };

/// Rust 측 `SshConnectError` (serde tag "kind", snake_case)와 일치.
export type SshConnectError =
  | {
      kind: "host_key_mismatch";
      host: string;
      port: number;
      algorithm: string;
      stored: string;
      presented: string;
    }
  | {
      kind: "first_contact";
      host: string;
      port: number;
      algorithm: string;
      fingerprint: string;
    }
  | { kind: "other"; message: string };

export function isSshConnectError(e: unknown): e is SshConnectError {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as { kind?: unknown };
  return (
    obj.kind === "host_key_mismatch" ||
    obj.kind === "first_contact" ||
    obj.kind === "other"
  );
}
