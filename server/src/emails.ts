import { computeTotals } from '../../src/lib/calc';
import { formatDate, formatMoney } from '../../src/lib/format';
import type { BusinessProfile, Client, InvoiceDocument } from '../../src/lib/types';
import type { EmailMessage } from './services';

const escape = (value: string | undefined) =>
  (value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(accent: string, inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1f2328">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;border-top:6px solid ${accent}">
  <tr><td style="padding:28px">${inner}</td></tr></table></td></tr></table></body></html>`;
}

function button(url: string, label: string, accent: string) {
  return `<a href="${escape(url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${escape(label)}</a>`;
}

export function loginCodeEmail(appName: string, code: string, to: string): EmailMessage {
  return {
    to,
    subject: `${code} is your ${appName} sign-in code`,
    text: `Your ${appName} sign-in code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: layout(
      '#2563EB',
      `<p style="margin:0 0 12px">Your ${escape(appName)} sign-in code:</p>
       <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:0 0 12px">${code}</p>
       <p style="color:#6b7280;font-size:13px;margin:0">It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`
    ),
  };
}

export type DocumentEmailKind = 'send' | 'reminder_before' | 'reminder_due' | 'reminder_after';

export function documentEmail(params: {
  kind: DocumentEmailKind;
  to: string;
  doc: InvoiceDocument;
  client?: Client;
  profile?: BusinessProfile;
  url: string;
  message?: string;
  canPayOnline: boolean;
}): EmailMessage {
  const { kind, doc, client, profile, url, message, canPayOnline } = params;
  const business = profile?.name || 'Your business';
  const accent = /^#[0-9a-fA-F]{6}$/.test(profile?.accentColor ?? '') ? profile!.accentColor : '#2563EB';
  const totals = computeTotals(doc);
  const isInvoice = doc.type === 'invoice';
  const label = isInvoice ? 'Invoice' : 'Estimate';
  const amount = formatMoney(isInvoice ? totals.balance : totals.total, doc.currency);
  const due = doc.dueDate ? formatDate(doc.dueDate) : undefined;
  const greeting = client?.contactName || client?.name;

  const subject = {
    send: `${label} ${doc.number} from ${business}`,
    reminder_before: `Reminder: invoice ${doc.number} is due ${due ?? 'soon'}`,
    reminder_due: `Invoice ${doc.number} is due today`,
    reminder_after: `Overdue: invoice ${doc.number} from ${business}`,
  }[kind];

  const intro = {
    send: isInvoice
      ? `${business} sent you invoice ${doc.number} for ${amount}${due ? `, due ${due}` : ''}.`
      : `${business} sent you estimate ${doc.number} for ${amount}.`,
    reminder_before: `A friendly reminder that invoice ${doc.number} for ${amount} is due ${due}.`,
    reminder_due: `Invoice ${doc.number} for ${amount} is due today.`,
    reminder_after: `Invoice ${doc.number} for ${amount} was due ${due} and is now past due.`,
  }[kind];

  const cta = isInvoice ? (canPayOnline ? `View & pay ${amount}` : 'View invoice') : 'Review & approve estimate';

  const text = [
    greeting ? `Hi ${greeting},` : 'Hi,',
    '',
    intro,
    message ? `\n${message}\n` : '',
    `${cta}: ${url}`,
    '',
    `— ${business}${profile?.email ? `\n${profile.email}` : ''}`,
  ].join('\n');

  const html = layout(
    accent,
    `<p style="margin:0 0 16px">${escape(greeting ? `Hi ${greeting},` : 'Hi,')}</p>
     <p style="margin:0 0 16px">${escape(intro)}</p>
     ${message ? `<p style="margin:0 0 16px;white-space:pre-line">${escape(message)}</p>` : ''}
     <p style="margin:24px 0">${button(url, cta, accent)}</p>
     <p style="color:#6b7280;font-size:13px;margin:0">— ${escape(business)}${profile?.email ? `<br/>${escape(profile.email)}` : ''}</p>`
  );

  return { to: params.to, subject, text, html, fromName: business, replyTo: profile?.email || undefined };
}
