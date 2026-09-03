export type RendezvousMessage = {
  messageId: string;
  ciphertext: string;
  expiresAt: number;
  storedAt: number;
};

const maxPayloadBytes = 64 * 1024;
const maxTtlMs = 15 * 60 * 1000;

export class RendezvousStore {
  private readonly messages = new Map<string, RendezvousMessage[]>();

  put(mailboxId: string, message: Omit<RendezvousMessage, 'storedAt'>, now = Date.now()): void {
    this.purge(now);
    if (!mailboxId || mailboxId.length > 256) throw new Error('invalid mailbox');
    if (!message.messageId || message.messageId.length > 256 || !/^[A-Za-z0-9_-]+$/.test(message.messageId)) throw new Error('invalid message');
    if (typeof message.ciphertext !== 'string' || new TextEncoder().encode(message.ciphertext).byteLength === 0 || new TextEncoder().encode(message.ciphertext).byteLength > maxPayloadBytes) throw new Error('invalid payload');
    if (!Number.isSafeInteger(message.expiresAt) || message.expiresAt <= now || message.expiresAt > now + maxTtlMs) throw new Error('invalid expiry');
    const mailbox = this.messages.get(mailboxId) ?? [];
    if (!mailbox.some((candidate) => candidate.messageId === message.messageId)) mailbox.push({ ...message, storedAt: now });
    this.messages.set(mailboxId, mailbox);
  }

  get(mailboxId: string, now = Date.now()): RendezvousMessage[] {
    this.purge(now);
    return [...(this.messages.get(mailboxId) ?? [])];
  }

  ack(messageId: string, now = Date.now()): boolean {
    this.purge(now);
    for (const [mailboxId, mailbox] of this.messages) {
      const remaining = mailbox.filter((message) => message.messageId !== messageId);
      if (remaining.length !== mailbox.length) {
        if (remaining.length) this.messages.set(mailboxId, remaining);
        else this.messages.delete(mailboxId);
        return true;
      }
    }
    return false;
  }

  delete(messageId: string, now = Date.now()): boolean {
    return this.ack(messageId, now);
  }

  purge(now = Date.now()): void {
    for (const [mailboxId, mailbox] of this.messages) {
      const remaining = mailbox.filter((message) => message.expiresAt > now);
      if (remaining.length) this.messages.set(mailboxId, remaining);
      else this.messages.delete(mailboxId);
    }
  }
}
