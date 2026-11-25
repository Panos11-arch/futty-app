import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { type DueAlert, type Email, resendSender, sendUrgentReportEmails, toEmail } from './handler.ts';

function alert(n: number): DueAlert {
  return { alert_id: `a${n}`, report_id: `r${n}`, context: 'player', created_at: '2026-11-24T21:30:00+00:00' };
}

/** A fake queue with the real rule: an emailed alert isn't due again. */
function setup(queue: DueAlert[]) {
  const fake = createDbFake();
  let waiting = [...queue];
  fake.respond('urgent_report_alerts_due', () => waiting);
  fake.respond('urgent_report_alert_emailed', (args: Record<string, unknown>) => {
    waiting = waiting.filter((a) => a.alert_id !== args.p_alert_id);
    return null;
  });
  return fake;
}

Deno.test('each urgent report is emailed to the founders once, even when the job runs again', async () => {
  const fake = setup([alert(1), alert(2)]);
  const sent: Email[] = [];
  const send = (email: Email) => {
    sent.push(email);
    return Promise.resolve();
  };

  const first = await sendUrgentReportEmails({ db: fake.db, sendEmail: send });
  const second = await sendUrgentReportEmails({ db: fake.db, sendEmail: send });

  deepStrictEqual(first, { due: 2, sent: 2, failed: 0 });
  deepStrictEqual(second, { due: 0, sent: 0, failed: 0 });
  strictEqual(sent.length, 2);
  deepStrictEqual(fake.callsTo('urgent_report_alert_emailed').map((c) => c.args), [
    { p_alert_id: 'a1' },
    { p_alert_id: 'a2' },
  ]);
});

Deno.test('a failed email stays due for the next run, and the others still go', async () => {
  const fake = setup([alert(1), alert(2)]);
  const send = (email: Email) =>
    email.text.includes('r1') ? Promise.reject(new Error('resend down')) : Promise.resolve();

  const summary = await sendUrgentReportEmails({ db: fake.db, sendEmail: send });

  deepStrictEqual(summary, { due: 2, sent: 1, failed: 1 });
  deepStrictEqual(fake.callsTo('urgent_report_alert_emailed').map((c) => c.args), [{ p_alert_id: 'a2' }]);
});

Deno.test('nothing due sends nothing', async () => {
  const fake = createDbFake();
  fake.respond('urgent_report_alerts_due', null);
  const summary = await sendUrgentReportEmails({ db: fake.db, sendEmail: () => Promise.reject(new Error('no')) });
  deepStrictEqual(summary, { due: 0, sent: 0, failed: 0 });
});

Deno.test('the email names the report and the time in Cyprus, and nothing about the players', () => {
  const email = toEmail(alert(7));
  strictEqual(email.subject, 'Urgent: report involving a minor');
  strictEqual(email.text.includes('r7'), true);
  strictEqual(email.text.includes('player'), true);
  // 21:30 UTC on 24 November is 23:30 in Cyprus.
  strictEqual(email.text.includes('24/11/2026, 23:30'), true);
});

Deno.test('resendSender posts to Resend with the key and every founder', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return Promise.resolve(new Response('{"id":"e1"}', { status: 200 }));
  };
  const send = resendSender(fakeFetch as typeof fetch, 'key_123', 'Futty <alerts@futty.app>', 'a@x.test, b@x.test');
  await send({ subject: 'S', text: 'T' });

  strictEqual(requests.length, 1);
  strictEqual(requests[0].url, 'https://api.resend.com/emails');
  strictEqual((requests[0].init.headers as Record<string, string>).Authorization, 'Bearer key_123');
  deepStrictEqual(JSON.parse(requests[0].init.body as string), {
    from: 'Futty <alerts@futty.app>',
    to: ['a@x.test', 'b@x.test'],
    subject: 'S',
    text: 'T',
  });
});

Deno.test('resendSender throws when Resend refuses, so the alert stays due', async () => {
  const fakeFetch = () => Promise.resolve(new Response('bad', { status: 422 }));
  const send = resendSender(fakeFetch as typeof fetch, 'key', 'from@x.test', 'a@x.test');
  await rejects(send({ subject: 'S', text: 'T' }), /resend_422/);
});
