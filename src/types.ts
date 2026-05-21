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
