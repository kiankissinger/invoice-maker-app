// Pure HTML rendering for invoices/estimates. Shared by the app (PDF export) and the
// server (hosted invoice page), so it must not import React Native or Expo modules.
import { computeTotals, depositStatus, lineTotal } from './calc';
import { formatDate, formatMoney } from './format';
import type { BusinessProfile, Client, InvoiceDocument, TemplateId } from './types';

export const SIGNATURE_WIDTH = 320;
export const SIGNATURE_HEIGHT = 140;

export const TEMPLATES: { id: TemplateId; name: string; pro: boolean }[] = [
  { id: 'classic', name: 'Classic', pro: false },
  { id: 'modern', name: 'Modern', pro: true },
  { id: 'minimal', name: 'Minimal', pro: true },
  { id: 'bold', name: 'Bold', pro: true },
];

export type RenderInput = {
  doc: InvoiceDocument;
  client?: Client;
  profile: BusinessProfile;
  isPro: boolean;
  appName: string;
  /** Extra HTML inserted at the top of <body> (used by the hosted invoice page). */
  bodyPrefix?: string;
  /** Extra CSS appended to the stylesheet. */
  extraCss?: string;
};

const escape = (value: string | undefined) =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const multiline = (value: string | undefined) => escape(value).replace(/\n/g, '<br/>');

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;

export function renderDocumentHtml({ doc, client, profile, isPro, appName, bodyPrefix = '', extraCss = '' }: RenderInput): string {
  const template: TemplateId =
    isPro || TEMPLATES.find((t) => t.id === doc.templateId)?.pro === false ? doc.templateId : 'classic';
  const accent = isPro && SAFE_COLOR.test(profile.accentColor) ? profile.accentColor : '#2563EB';
  const totals = computeTotals(doc);
  const money = (n: number) => formatMoney(n, doc.currency);
  const title = doc.type === 'invoice' ? 'INVOICE' : 'ESTIMATE';
  const dueLabel = doc.type === 'invoice' ? 'Due date' : 'Valid until';

  const rows = doc.items
    .filter((item) => item.description.trim() || item.unitPrice)
    .map(
      (item) => `
      <tr>
        <td>
          <div class="item">${escape(item.description)}</div>
          ${item.details ? `<div class="muted">${multiline(item.details)}</div>` : ''}
        </td>
        <td class="num">${item.quantity}${item.unit ? ` ${escape(item.unit)}` : ''}</td>
        <td class="num">${money(item.unitPrice)}</td>
        <td class="num">${money(lineTotal(item))}</td>
      </tr>`
    )
    .join('');

  const totalRow = (label: string, value: string, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;

  const discountLabel =
    doc.discount.kind === 'percent' ? `Discount (${doc.discount.value}%)` : 'Discount';

  const signature = doc.signature
    ? `<div class="signature">
        <svg viewBox="0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}" width="220" height="${Math.round((220 * SIGNATURE_HEIGHT) / SIGNATURE_WIDTH)}">
          <path d="${escape(doc.signature.path)}" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="muted">Signed ${escape(formatDate(doc.signature.signedAt.slice(0, 10)))}</div>
      </div>`
    : '';

  const approval = doc.approval
    ? `<div class="approval">✓ Accepted by ${escape(doc.approval.name)} on ${escape(formatDate(doc.approval.at.slice(0, 10)))}</div>`
    : '';

  const photos = (doc.photos ?? []).filter((p) => /^data:image\/(jpeg|png);base64,/.test(p.uri));
  const photoGrid = photos.length
    ? `<div class="photos"><div class="label">Photos</div><div class="grid">${photos
        .map((p) => `<figure><img src="${escape(p.uri)}"/>${p.caption ? `<figcaption>${escape(p.caption)}</figcaption>` : ''}</figure>`)
        .join('')}</div></div>`
    : '';

  const deposit = depositStatus(doc);
  const paidSoFar = totals.paid > 0;

  const watermark = isPro
    ? ''
    : `<div class="watermark">Created with ${escape(appName)} — free plan</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { margin: 36px; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1f2328; font-size: 12px; margin: 0; }
  .muted { color: #6b7280; font-size: 11px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { max-height: 72px; max-width: 180px; object-fit: contain; margin-bottom: 8px; }
  .biz-name { font-size: 18px; font-weight: 700; }
  .doc-title { font-size: 28px; font-weight: 800; letter-spacing: 2px; color: ${accent}; text-align: right; }
  .meta { text-align: right; margin-top: 6px; line-height: 1.6; }
  .meta b { display: inline-block; min-width: 80px; color: #6b7280; font-weight: 500; }
  .parties { display: flex; gap: 24px; margin: 28px 0 20px; }
  .parties > div { flex: 1; line-height: 1.5; }
  .label { text-transform: uppercase; font-size: 10px; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  .items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 8px; }
  .items td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .item { font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  .items th.num { text-align: right; }
  .summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 16px; }
  .summary .left { flex: 1; line-height: 1.5; }
  .totals { width: 260px; }
  .totals td { padding: 6px 8px; }
  .totals .grand td { font-size: 15px; font-weight: 800; border-top: 2px solid ${accent}; }
  .totals .due td { font-weight: 700; color: ${accent}; }
  .block { margin-top: 18px; }
  .signature { margin-top: 24px; }
  .signature svg { border-bottom: 1px solid #9ca3af; }
  .watermark { margin-top: 40px; text-align: center; color: #9ca3af; font-size: 10px; }
  .approval { margin-top: 12px; color: #16a34a; font-weight: 600; }
  .photos { margin-top: 24px; page-break-inside: avoid; }
  .photos .grid { display: flex; flex-wrap: wrap; gap: 10px; }
  .photos figure { margin: 0; width: calc(33.33% - 7px); }
  .photos img { display: block; width: 100%; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
  .photos figcaption { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .paid-stamp { display: inline-block; border: 3px solid #16a34a; color: #16a34a; font-weight: 800; padding: 4px 12px; transform: rotate(-8deg); font-size: 18px; margin-top: 8px; }

  /* Templates */
  .t-classic .items thead th { background: ${accent}; color: #fff; }
  .t-modern .top-bar { height: 8px; background: ${accent}; border-radius: 4px; margin-bottom: 24px; }
  .t-modern .items thead th { border-bottom: 2px solid ${accent}; color: ${accent}; }
  .t-modern .parties > div { background: #f6f8fa; padding: 12px; border-radius: 8px; }
  .t-minimal .doc-title { color: #111; font-weight: 300; letter-spacing: 6px; }
  .t-minimal .items thead th { border-bottom: 1px solid #111; color: #111; }
  .t-minimal .totals .grand td { border-top: 1px solid #111; }
  .t-bold .header { background: ${accent}; color: #fff; padding: 20px; border-radius: 10px; }
  .t-bold .header .doc-title, .t-bold .header .meta b, .t-bold .header .muted { color: #fff; }
  .t-bold .items thead th { background: #111827; color: #fff; }
  ${extraCss}
</style>
</head>
<body class="t-${template}">
  ${bodyPrefix}
  <div class="top-bar"></div>
  <div class="header">
    <div>
      ${profile.logoDataUri ? `<img class="logo" src="${escape(profile.logoDataUri)}"/>` : ''}
      <div class="biz-name">${escape(profile.name || 'Your Business')}</div>
      <div class="muted">${multiline(profile.address)}</div>
      <div class="muted">${[profile.email, profile.phone, profile.website].filter(Boolean).map(escape).join(' · ')}</div>
      ${profile.taxId ? `<div class="muted">Tax ID: ${escape(profile.taxId)}</div>` : ''}
    </div>
    <div>
      <div class="doc-title">${title}</div>
      <div class="meta">
        <div><b>Number</b> ${escape(doc.number)}</div>
        <div><b>Date</b> ${formatDate(doc.issueDate)}</div>
        ${doc.dueDate ? `<div><b>${dueLabel}</b> ${formatDate(doc.dueDate)}</div>` : ''}
        ${doc.poNumber ? `<div><b>PO #</b> ${escape(doc.poNumber)}</div>` : ''}
      </div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="label">Bill to</div>
      ${
        client
          ? `<div class="item">${escape(client.name)}</div>
             ${client.contactName ? `<div>${escape(client.contactName)}</div>` : ''}
             <div class="muted">${multiline(client.address)}</div>
             <div class="muted">${[client.email, client.phone].filter(Boolean).map(escape).join(' · ')}</div>`
          : '<div class="muted">—</div>'
      }
    </div>
    <div>
      <div class="label">${doc.type === 'invoice' ? 'Balance due' : 'Estimate total'}</div>
      <div style="font-size: 22px; font-weight: 800;">${money(doc.type === 'invoice' ? totals.balance : totals.total)}</div>
      ${doc.type === 'invoice' && totals.total > 0 && totals.balance <= 0 ? '<div class="paid-stamp">PAID</div>' : ''}
    </div>
  </div>

  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div class="left">
      ${profile.paymentInstructions && doc.type === 'invoice' ? `<div class="block"><div class="label">How to pay</div>${multiline(profile.paymentInstructions)}</div>` : ''}
      ${doc.notes ? `<div class="block"><div class="label">Notes</div>${multiline(doc.notes)}</div>` : ''}
      ${doc.terms ? `<div class="block"><div class="label">Terms</div>${multiline(doc.terms)}</div>` : ''}
      ${signature}
      ${approval}
    </div>
    <table class="totals">
      ${totalRow('Subtotal', money(totals.subtotal))}
      ${totals.discount ? totalRow(discountLabel, `−${money(totals.discount)}`) : ''}
      ${totals.tax ? totalRow(`${escape(doc.taxLabel)} (${doc.taxRate}%)`, money(totals.tax)) : ''}
      ${totals.shipping ? totalRow('Shipping', money(totals.shipping)) : ''}
      ${totals.withholding ? totalRow(`${escape(doc.withholdingLabel || 'Withholding')} (${doc.withholdingRate}%)`, `−${money(totals.withholding)}`) : ''}
      ${totalRow('Total', money(totals.total), 'grand')}
      ${deposit.amount ? totalRow(`Deposit${doc.deposit?.kind === 'percent' ? ` (${doc.deposit.value}%)` : ''}`, money(deposit.amount)) : ''}
      ${paidSoFar ? totalRow('Paid', `−${money(totals.paid)}`) : ''}
      ${paidSoFar ? totalRow('Balance due', money(totals.balance), 'due') : ''}
    </table>
  </div>
  ${photoGrid}
  ${watermark}
</body>
</html>`;
}
