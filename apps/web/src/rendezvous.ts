export type RendezvousMessage = {
  messageId: string;
  ciphertext: string;
  expiresAt: number;
};

export type RendezvousClient = {
  put(mailboxId: string, message: RendezvousMessage): Promise<void>;
  get(mailboxId: string, waitSeconds?: number): Promise<RendezvousMessage[]>;
  ack(mailboxId: string, messageId: string): Promise<void>;
};

export function createHttpRendezvousClient(baseUrl: string): RendezvousClient {
  const normalize = (url: string) => url.replace(/\/+$/, '');
  const url = normalize(baseUrl);

  return {
    async put(mailboxId: string, message: RendezvousMessage) {
      const res = await fetch(`${url}/v1/mailboxes/${encodeURIComponent(mailboxId)}/messages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (!res.ok) throw new Error(`Rendezvous PUT failed: ${res.status}`);
    },

    async get(mailboxId: string, waitSeconds: number = 0) {
      const res = await fetch(`${url}/v1/mailboxes/${encodeURIComponent(mailboxId)}/messages?wait=${waitSeconds}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error(`Rendezvous GET failed: ${res.status}`);
      const body = await res.json() as { messages: RendezvousMessage[] };
      return body.messages;
    },

    async ack(mailboxId: string, messageId: string) {
      const res = await fetch(`${url}/v1/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}/ack`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Rendezvous ACK failed: ${res.status}`);
    },
  };
}
