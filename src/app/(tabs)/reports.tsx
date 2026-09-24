import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExpensesPanel, ProfitSummary } from '@/components/expenses-panel';
import { AppText, Button, Card, ListRow, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useIsPro } from '@/lib/purchases';
import { useTheme } from '@/hooks/use-theme';
import { computeTotals, daysBetween, displayStatus, todayISO } from '@/lib/calc';
import { formatMoney } from '@/lib/format';
import { useStore } from '@/lib/store';

const MONTHS = 6;

function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 - (count - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export default function ReportsTab() {
  const theme = useTheme();
  const isPro = useIsPro();
  const documents = useStore((s) => s.documents);
  const clients = useStore((s) => s.clients);
  const currency = useStore((s) => s.profile.currency);
  const today = todayISO();

  const report = useMemo(() => {
    const months = lastMonths(today, MONTHS);
    const invoiced: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
    const collected: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
    const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
    const byClient: Record<string, number> = {};
    let yearCollected = 0;

    for (const doc of Object.values(documents)) {
      if (doc.type !== 'invoice' || doc.status === 'void' || doc.status === 'draft') continue;
      const totals = computeTotals(doc);
      const month = doc.issueDate.slice(0, 7);
      if (month in invoiced) invoiced[month] += totals.total;
      for (const p of doc.payments) {
        const pm = p.date.slice(0, 7);
        if (pm in collected) collected[pm] += p.amount;
        if (p.date.startsWith(today.slice(0, 4))) yearCollected += p.amount;
        if (doc.clientId) byClient[doc.clientId] = (byClient[doc.clientId] ?? 0) + p.amount;
      }
      if (totals.balance > 0) {
        const late = doc.dueDate ? daysBetween(doc.dueDate, today) : 0;
        if (late <= 0) aging.current += totals.balance;
        else if (late <= 30) aging.d30 += totals.balance;
        else if (late <= 60) aging.d60 += totals.balance;
        else aging.d90 += totals.balance;
      }
    }

    const topClients = Object.entries(byClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const max = Math.max(1, ...months.map((m) => Math.max(invoiced[m], collected[m])));
    const openEstimates = Object.values(documents).filter(
      (d) => d.type === 'estimate' && (displayStatus(d) === 'sent' || displayStatus(d) === 'accepted')
    );
    const pipeline = openEstimates.reduce((sum, d) => sum + computeTotals(d).total, 0);

    return { months, invoiced, collected, aging, topClients, max, yearCollected, pipeline };
  }, [documents, today]);

  if (!isPro) {
    return (
      <Screen>
        <ProfitSummary />
        <ExpensesPanel />
        <Card>
          <AppText variant="heading">Know where your money is</AppText>
          <AppText variant="caption">Monthly revenue, unpaid invoices by age, top clients and your estimate pipeline. Included with Pro.</AppText>
          <Button title="Unlock reports" icon="sparkles" onPress={() => router.push({ pathname: '/paywall', params: { feature: 'reports' } })} />
        </Card>
      </Screen>
    );
  }

  const money = (n: number) => formatMoney(n, currency);
  const monthName = (m: string) => new Date(`${m}-15T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

  return (
    <Screen>
      <ProfitSummary />
      <ExpensesPanel />
      <Card>
        <AppText variant="caption">Open & accepted estimates</AppText>
        <AppText variant="heading">{money(report.pipeline)}</AppText>
      </Card>

      <Section title={`Last ${MONTHS} months`}>
        <View style={styles.chart}>
          {report.months.map((m) => (
            <View key={m} style={styles.barGroup}>
              <View style={styles.bars}>
                <View style={[styles.bar, { height: `${(report.invoiced[m] / report.max) * 100}%`, backgroundColor: theme.backgroundSelected }]} />
                <View style={[styles.bar, { height: `${(report.collected[m] / report.max) * 100}%`, backgroundColor: theme.tint }]} />
              </View>
              <AppText variant="caption">{monthName(m)}</AppText>
            </View>
          ))}
        </View>
        <Row style={{ justifyContent: 'center', gap: Spacing.three }}>
          <Legend color={theme.backgroundSelected} label="Invoiced" />
          <Legend color={theme.tint} label="Collected" />
        </Row>
      </Section>

      <Section title="Unpaid by age">
        <ListRow title="Not yet due" right={<AppText variant="amount">{money(report.aging.current)}</AppText>} />
        <ListRow title="1–30 days late" right={<AppText variant="amount">{money(report.aging.d30)}</AppText>} />
        <ListRow title="31–60 days late" right={<AppText variant="amount">{money(report.aging.d60)}</AppText>} />
        <ListRow title="60+ days late" last right={<AppText variant="amount" color={report.aging.d90 ? 'danger' : 'text'}>{money(report.aging.d90)}</AppText>} />
      </Section>

      <Section title="Top clients">
        {report.topClients.length === 0 ? <AppText variant="caption">Record payments to see your top clients.</AppText> : null}
        {report.topClients.map(([clientId, amount], i) => (
          <ListRow
            key={clientId}
            title={clients[clientId]?.name ?? 'Deleted client'}
            last={i === report.topClients.length - 1}
            right={<AppText variant="amount">{money(amount)}</AppText>}
            onPress={clients[clientId] ? () => router.push(`/client/${clientId}`) : undefined}
          />
        ))}
      </Section>
    </Screen>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row style={{ gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <AppText variant="caption">{label}</AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', height: 160, alignItems: 'flex-end', gap: Spacing.two },
  barGroup: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 3, width: '100%', justifyContent: 'center' },
  bar: { width: 10, borderRadius: 3, minHeight: 2 },
});
