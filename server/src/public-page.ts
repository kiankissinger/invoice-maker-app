import { computeTotals } from '../../src/lib/calc';
import { formatMoney } from '../../src/lib/format';
import { renderDocumentHtml } from '../../src/lib/invoice-html';
import type { BusinessProfile, Client, InvoiceDocument } from '../../src/lib/types';

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
    .pay-bar .print { background: #e5e7eb; color: #111; }
    .pay-bar.ok { background: #ecfdf5; border-color: #a7f3d0; }
  }
  @media print { .pay-bar { display: none; } }
`;

export function hostedInvoicePage(params: {
  doc: InvoiceDocument;
  profile?: BusinessProfile;
  client?: Client;
  appName: string;
  token: string;
  payable: boolean;
  justPaid: boolean;
}): string {
  const { doc, profile, client, appName, token, payable, justPaid } = params;
  const totals = computeTotals(doc);
  const balance = formatMoney(totals.balance, doc.currency);

  let message: string;
  let cls = 'pay-bar';
  if (justPaid) {
    message = 'Thank you! Your payment was received.';
    cls += ' ok';
  } else if (doc.type === 'invoice' && totals.total > 0 && totals.balance <= 0) {
    message = 'This invoice is paid in full. Thank you!';
    cls += ' ok';
  } else if (doc.type === 'invoice') {
    message = `Balance due: <b>${escape(balance)}</b>`;
  } else {
    message = `Estimate total: <b>${escape(formatMoney(totals.total, doc.currency))}</b>`;
  }

  const bar = `<div class="${cls}">
    <div class="msg">${message}</div>
    <div class="actions">
      <button class="print" type="button" onclick="window.print()">Download PDF</button>
      ${payable && !justPaid ? `<form method="post" action="/i/${escape(token)}/pay"><button class="pay" type="submit">Pay ${escape(balance)}</button></form>` : ''}
    </div>
  </div>`;

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
  }).replace('<head>', `<head><title>${escape(`${doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${doc.number}`)}</title><meta name="robots" content="noindex"/>`);
}

export function simplePage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escape(title)}</title><meta name="robots" content="noindex"/>
  <style>body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center;color:#1f2328}
  a.btn{display:inline-block;margin-top:16px;background:#2563EB;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600}</style>
  </head><body><h1>${escape(title)}</h1>${body}</body></html>`;
}
