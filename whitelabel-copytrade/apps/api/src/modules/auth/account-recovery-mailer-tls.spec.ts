import { readFileSync } from 'node:fs';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import { AccountRecoveryMailer } from './account-recovery-mailer.service';

const certificate = process.env.BATCH02_SMTP_TEST_CERT;
const key = process.env.BATCH02_SMTP_TEST_KEY;
(certificate && key ? describe : describe.skip)('recovery SMTP over a real TLS connection', () => {
  let server: Server, port: number;
  const messages: string[] = [];

  beforeAll(async () => {
    server = createServer({ cert: readFileSync(certificate!), key: readFileSync(key!) }, (socket: TLSSocket) => {
      let pending = '', data = false, lines: string[] = [];
      socket.write('220 localhost test ESMTP\r\n');
      socket.on('data', (chunk: Buffer) => {
        pending += chunk.toString('utf8');
        let index: number;
        while ((index = pending.indexOf('\r\n')) >= 0) {
          const line = pending.slice(0, index); pending = pending.slice(index + 2);
          if (data) {
            if (line === '.') { messages.push(lines.join('\n')); data = false; lines = []; socket.write('250 2.0.0 accepted\r\n'); }
            else lines.push(line);
          } else if (/^EHLO /i.test(line)) socket.write('250-localhost\r\n250 SIZE 100000\r\n');
          else if (/^HELO /i.test(line)) socket.write('250 localhost\r\n');
          else if (/^MAIL FROM:/i.test(line) || /^RCPT TO:/i.test(line) || /^RSET/i.test(line)) socket.write('250 OK\r\n');
          else if (/^DATA$/i.test(line)) { data = true; socket.write('354 End with dot\r\n'); }
          else if (/^QUIT$/i.test(line)) { socket.write('221 Bye\r\n'); socket.end(); }
          else socket.write('500 Unknown command\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test SMTP server did not bind');
    port = address.port;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it('verifies the server and sends a real mail without exposing the response', async () => {
    const mailer = new AccountRecoveryMailer({ mailDriver: 'smtp', smtpOptions: { host: '127.0.0.1', port, secure: true, user: '', password: '' },
      mailFrom: { address: 'sender@example.test', name: 'Test' } } as never);
    expect(mailer.isConfigured()).toBe(true);
    expect(await mailer.verify()).toBe(true);
    await expect(mailer.send('owner@example.test', 'https://tenant.example.test/recovery#token=synthetic-test')).resolves.toBeUndefined();
    expect(messages).toHaveLength(1);
    // The real SMTP transport uses quoted-printable and may fold long lines.
    const decoded = messages[0].replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    expect(decoded).toContain('owner@example.test');
    expect(decoded).toContain('https://tenant.example.test/recovery#token=synthetic-test');
    expect(decoded).toContain('two-factor authentication settings remain unchanged');
  }, 15000);

  it('does not treat console mail as available', async () => {
    const mailer = new AccountRecoveryMailer({ mailDriver: 'console', smtpOptions: {}, mailFrom: { address: 'sender@example.test' } } as never);
    expect(mailer.isConfigured()).toBe(false); expect(await mailer.verify()).toBe(false);
    await expect(mailer.send('owner@example.test', 'https://tenant.example.test/recovery#token=synthetic-test')).rejects.toThrow('RECOVERY_MAIL_NOT_CONFIGURED');
  });
});
