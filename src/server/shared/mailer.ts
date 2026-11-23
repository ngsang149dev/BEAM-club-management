export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class NoopMailer implements Mailer {
  async send(_message: MailMessage): Promise<void> {
    void _message;
  }
}
