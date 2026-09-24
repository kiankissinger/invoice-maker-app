import { router } from 'expo-router';
import { useMemo } from 'react';

import { AppText, Button, Card, ListRow, Row, Section } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { useStore } from '@/lib/store';

/** Year-to-date money in, money out and profit. */
export function ProfitSummary() {
  const documents = useStore((s) => s.documents);
  const expenses = useStore((s) => s.expenses);
  const currency = useStore((s) => s.profile.currency);
  const year = String(new Date().getFullYear());

  const { income, spent } = useMemo(() => {
    let income = 0;
    for (const doc of Object.values(documents)) {
      if (doc.status === 'void') continue;
      for (const p of doc.payments) if (p.date.startsWith(year)) income += p.amount;
    }
    const spent = Object.values(expenses)
      .filter((e) => e.date.startsWith(year))
      .reduce((sum, e) => sum + e.amount, 0);
    return { income, spent };
  }, [documents, expenses, year]);

  const money = (n: number) => formatMoney(n, currency);
  return (
    <Row style={{ alignItems: 'stretch' }}>
      <Card style={{ flex: 1 }}>
        <AppText variant="caption">Income {year}</AppText>
        <AppText variant="amount">{money(income)}</AppText>
      </Card>
      <Card style={{ flex: 1 }}>
        <AppText variant="caption">Expenses</AppText>
        <AppText variant="amount">{money(spent)}</AppText>
      </Card>
      <Card style={{ flex: 1 }}>
        <AppText variant="caption">Profit</AppText>
        <AppText variant="amount" color={income - spent >= 0 ? 'success' : 'danger'}>
          {money(income - spent)}
        </AppText>
      </Card>
    </Row>
  );
}

export function ExpensesPanel() {
  const expenses = useStore((s) => s.expenses);
  const recent = useMemo(
    () => Object.values(expenses).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 15),
    [expenses]
  );

  return (
    <Section title="Expenses">
      <Row>
        <Button
          title="Scan receipt"
          icon="scan-outline"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/expense/[id]', params: { id: 'new', scan: '1' } })}
        />
        <Button title="Add" icon="add" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/expense/new')} />
      </Row>
      {recent.length === 0 ? (
        <AppText variant="caption">Track materials, fuel and other costs to see your real profit and be ready at tax time.</AppText>
      ) : (
        recent.map((e, i) => (
          <ListRow
            key={e.id}
            icon={e.receiptUri ? 'receipt-outline' : 'cash-outline'}
            title={e.vendor}
            subtitle={`${formatDate(e.date)} · ${e.category}`}
            right={<AppText variant="amount">{formatMoney(e.amount, e.currency)}</AppText>}
            last={i === recent.length - 1}
            onPress={() => router.push(`/expense/${e.id}`)}
          />
        ))
      )}
    </Section>
  );
}
