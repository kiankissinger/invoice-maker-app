import { computeTotals, depositStatus } from '../../src/lib/calc';
import { formatMoney } from '../../src/lib/format';
import { renderDocumentHtml } from '../../src/lib/invoice-html';
import type { BusinessProfile, Client, InvoiceDocument } from '../../src/lib/types';
import type { Payable } from './sharing';

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BAR_CSS = `
  @media screen {
    body { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; }
    .pay-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 14px 16px; margin-bottom: 24px; border-radius: 12px; background: #f6f8fa; border: 1px solid #e5e7eb; }
    .pay-bar .msg { font-size: 14px; }
    .pay-bar .actions { display: flex; gap: 8px; }
    .pay-bar button { font: inherit; font-size: 15px; font-weight: 600; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
    .pay-bar .pay { background: #16a34a; color: #fff; }
    .pay-bar .print, .pay-bar .secondary { background: #e5e7eb; color: #111; }
    .pay-bar .actions { flex-wrap: wrap; }
    .accept { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 14px 16px; margin: -12px 0 24px;
      border-radius: 12px; border: 1px solid #bfdbfe; background: #eff6ff; }
    .accept .msg { flex-basis: 100%; font-size: 14px; }
    .accept input { flex: 1; min-width: 180px; font: inherit; font-size: 15px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; }
    .accept button { font: inherit; font-size: 15px; font-weight: 600; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; background: #16a34a; color: #fff; }
    .pay-bar.ok { background: #ecfdf5; border-color: #a7f3d0; }
  }
  @media print { .pay-bar, .accept { display: none; } }
`;

export function hostedInvoicePage(params: {
  doc: InvoiceDocument;
  profile?: BusinessProfile;
  client?: Client;
  appName: string;
  token: string;
  payable: Payable;
  canAccept: boolean;
  banner?: 'paid' | 'accepted';
}): string {
  const { doc, profile, client, appName, token, payable, canAccept, banner } = params;
  const totals = computeTotals(doc);
  const money = (n: number) => formatMoney(n, doc.currency);
  const isInvoice = doc.type === 'invoice';

  let message: string;
  let cls = 'pay-bar';
  if (banner === 'paid') {
    message = 'Thank you! Your payment was received.';
    cls += ' ok';
  } else if (banner === 'accepted') {
    message = payable.deposit ? 'Estimate accepted — thank you! Pay the deposit to get started.' : 'Estimate accepted — thank you!';
    cls += ' ok';
  } else if (isInvoice && totals.total > 0 && totals.balance <= 0) {
    message = 'This invoice is paid in full. Thank you!';
    cls += ' ok';
  } else if (isInvoice) {
    message = `Balance due: <b>${escape(money(totals.balance))}</b>`;
  } else if (doc.status === 'accepted' || doc.status === 'converted') {
    message = `Estimate accepted${doc.approval ? ` by ${escape(doc.approval.name)}` : ''}.`;
    cls += ' ok';
  } else {
    message = `Estimate total: <b>${escape(money(totals.total))}</b>`;
  }

  const payButton = (kind: 'deposit' | 'balance', amount: number, label: string, primary: boolean) =>
    `<form method="post" action="/i/${escape(token)}/pay"><input type="hidden" name="amount" value="${kind}"/>` +
    `<button class="${primary ? 'pay' : 'secondary'}" type="submit">${escape(label)} ${escape(money(amount))}</button></form>`;

  const actions = [
    `<button class="print" type="button" onclick="window.print()">Download PDF</button>`,
    payable.deposit !== undefined ? payButton('deposit', payable.deposit, 'Pay deposit', true) : '',
    payable.balance !== undefined ? payButton('balance', payable.balance, payable.deposit !== undefined ? 'Pay in full' : 'Pay', payable.deposit === undefined) : '',
  ].join('');

  const accept = canAccept
    ? `<form class="accept" method="post" action="/i/${escape(token)}/accept">
        <div class="msg"><b>Approve this estimate</b><br/><span class="muted">Type your full name to sign and accept${
          depositStatus(doc).amount ? `. A deposit of ${escape(money(depositStatus(doc).amount))} is requested` : ''
        }.</span></div>
        <input name="name" required maxlength="100" placeholder="Your full name" autocomplete="name"/>
        <button class="pay" type="submit">Accept estimate</button>
      </form>`
    : '';

  const bar = `<div class="${cls}"><div class="msg">${message}</div><div class="actions">${actions}</div></div>${accept}`;

  const fallbackProfile = {
    name: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    taxId: '',
    accentColor: '#2563EB',
    paymentInstructions: '',
  } as BusinessProfile;

  return renderDocumentHtml({
    doc,
    client,
    profile: profile ?? fallbackProfile,
    isPro: true,
    appName,
    bodyPrefix: bar,
    extraCss: BAR_CSS,
  }).replace('<head>', `<head><title>${escape(`${isInvoice ? 'Invoice' : 'Estimate'} ${doc.number}`)}</title><meta name="robots" content="noindex"/>`);
}

export function simplePage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escape(title)}</title><meta name="robots" content="noindex"/>
  <style>body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center;color:#1f2328}
  a.btn{display:inline-block;margin-top:16px;background:#2563EB;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600}</style>
  </head><body><h1>${escape(title)}</h1>${body}</body></html>`;
}
