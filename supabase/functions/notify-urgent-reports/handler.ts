// Emails the founders about every report that involves a minor (A7,
// docs/specs/05-product.md section 16).
//
// The reports_alert_urgent trigger writes an admin_alerts row (kind
// 'minor_report') for each urgent report. This job reads the ones not yet
// emailed with urgent_report_alerts_due, emails each one, and marks it with
// urgent_report_alert_emailed. A failed email is left due for the next run,
// never thrown: one failure doesn't stop the others.
//
// The email carries the report id, where it was made and when, never a
// name, a date of birth or the reason: the founders read the report itself
// in the admin_reports view (Supabase dashboard), urgent first.
import { CYPRUS_TIME_ZONE } from '../_shared/cyprus-time.ts';
import { type Db, rpc } from '../_shared/db.ts';

export type DueAlert = { alert_id: string; report_id: string; context: string; created_at: string };

export type Email = { subject: string; text: string };

export type SendEmail = (email: Email) => Promise<void>;

export type Deps = { db: Db; sendEmail: SendEmail };

const cyprusTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function toEmail(alert: DueAlert): Email {
  return {
    subject: 'Urgent: report involving a minor',
    text: [
      'A report involving a minor needs looking at now.',
      '',
      `Report: ${alert.report_id}`,
      `Where: ${alert.context}`,
      `When: ${cyprusTime.format(new Date(alert.created_at))} (Cyprus)`,
      '',
      'Open public.admin_reports in the Supabase dashboard.',
    ].join('\n'),
  };
}

export async function sendUrgentReportEmails(deps: Deps) {
  const summary = { due: 0, sent: 0, failed: 0 };
  const due = (await rpc<DueAlert[] | null>(deps.db, 'urgent_report_alerts_due')) ?? [];
  summary.due = due.length;

  for (const alert of due) {
    try {
      await deps.sendEmail(toEmail(alert));
    } catch (err) {
      console.error('urgent report email failed:', alert.alert_id, err);
      summary.failed += 1;
      continue;
    }
    summary.sent += 1;
    try {
      await rpc(deps.db, 'urgent_report_alert_emailed', { p_alert_id: alert.alert_id });
    } catch (err) {
      // Sent but not marked: the next run emails it again, which is the safe side.
      console.error('urgent_report_alert_emailed failed:', alert.alert_id, err);
    }
  }
  return summary;
}

/** Sends through Resend's REST API to every address in `to` (comma separated). */
export function resendSender(fetchFn: typeof fetch, apiKey: string, from: string, to: string): SendEmail {
  const recipients = to.split(',').map((a) => a.trim()).filter(Boolean);
  return async (email) => {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject: email.subject, text: email.text }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`resend_${response.status}`);
    }
    await response.body?.cancel();
  };
}
