import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { InventoryOverview } from '../components/inventory-overview';
import { ScreenLayout } from '../components/screen-layout';
import { STORE_TYPES } from '../config/store-types';
import { useProfile } from '../hooks/use-profile';
import { ShopHeader } from '../components/shop-header';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { db } from '../db/db';
import { addExpense, listExpenses } from '../repos/expenses';
import { listMovementsForVariant } from '../repos/movements';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { parseCurrency } from '../i18n/parse-currency';
import { periodRange, type Period } from '../utils/period';
import { type ExpenseCategory, type RecurringPeriod } from '../types';

const PERIODS: ReadonlyArray<Period> = ['today', 'week', 'month', 'year'];

const EXPENSE_CATEGORIES: ReadonlyArray<ExpenseCategory> = [
  'supplier_transport',
  'rent',
  'electricity',
  'internet',
  'packaging',
  'taxes',
  'other',
];

interface PeriodMetrics {
  revenue: number;
  netProfit: number;
  pairsSold: number;
  purchases: number;
  expenses: number;
  inPocket: number;
  grossProfit: number;
}

async function computeMetrics(period: Period): Promise<PeriodMetrics> {
  const { fromISO, toISO } = periodRange(new Date(), period);
  const [articles, variants, expenses] = await Promise.all([
    db.articles.toArray(),
    db.variants.toArray(),
    listExpenses(db, { from: fromISO, to: toISO }),
  ]);
  const articleById = new Map(articles.map((a) => [a.id, a]));
  let revenue = 0;
  let purchases = 0;
  let pairsSold = 0;
  let grossProfit = 0;
  for (const v of variants) {
    const movements = await listMovementsForVariant(db, v.id, { since: fromISO });
    for (const m of movements) {
      if (m.created_at >= toISO) continue;
      const article = articleById.get(v.article_id);
      if (!article) continue;
      if (m.type === 'sale') {
        const sold = Math.abs(m.delta);
        // Honor per-movement price override if the cashier set one
        // (discount, promo). Falls back to the article's catalogue
        // price for the vast majority of sales where no override
        // was set.
        const unitPrice = m.unit_price_tnd ?? article.sale_price_tnd;
        revenue += sold * unitPrice;
        grossProfit += sold * (unitPrice - article.cost_price_tnd);
        pairsSold += sold;
      } else if (m.type === 'purchase' && m.delta > 0) {
        purchases += m.delta * article.cost_price_tnd;
      }
    }
  }
  const totalExpenses = expenses.reduce((s, e) => s + e.amount_tnd, 0);
  return {
    revenue,
    netProfit: grossProfit - totalExpenses,
    pairsSold,
    purchases,
    expenses: totalExpenses,
    inPocket: revenue - purchases - totalExpenses,
    grossProfit,
  };
}

export function DashboardScreen(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const { t: tExpense } = useTranslation('expense');
  const { t: tCommon } = useTranslation('common');
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const sized = STORE_TYPES[profile?.store_type ?? 'shoes'].has_sizes;
  const [period, setPeriod] = useState<Period>('today');
  const metrics = useLive<PeriodMetrics>(() => computeMetrics(period), [period]);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('supplier_transport');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [expRecurring, setExpRecurring] = useState<RecurringPeriod>('none');

  const m = metrics ?? {
    revenue: 0,
    netProfit: 0,
    pairsSold: 0,
    purchases: 0,
    expenses: 0,
    inPocket: 0,
    grossProfit: 0,
  };

  async function saveExpense(): Promise<void> {
    const amount = parseCurrency(expAmount, locale, currency);
    if (amount === null || amount <= 0) return;
    await addExpense(db, {
      category: expCategory,
      amount_tnd: amount,
      note: expNote.trim() === '' ? null : expNote.trim(),
      at: new Date().toISOString(),
      recurring: expRecurring,
    });
    setExpAmount('');
    setExpNote('');
    setExpRecurring('none');
    setExpenseOpen(false);
  }

  const periodLabel = useMemo(() => `period_${period}` as const, [period]);
  void periodLabel;

  return (
    <ScreenLayout>
      <ShopHeader />
      <main
        data-testid="dashboard-screen"
        className="flex flex-1 flex-col gap-4 px-5 py-4 overflow-y-auto"
      >
        <InventoryOverview />

        <div
          data-testid="period-selector"
          className="border-hair flex rounded-xl border bg-white p-1"
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`period-${p}`}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`flex-1 rounded-lg py-1.5 text-xs ${period === p ? 'bg-ink text-white' : 'text-ink-2'}`}
            >
              {t(`period_${p}`)}
            </button>
          ))}
        </div>

        <section className="grid grid-cols-3 gap-2">
          <BigNumber
            testId="big-revenue"
            label={t('big_revenue')}
            value={formatCurrency(m.revenue, locale, currency)}
          />
          <BigNumber
            testId="big-profit"
            label={t('big_profit')}
            value={formatCurrency(m.netProfit, locale, currency)}
          />
          <BigNumber
            testId="big-pairs"
            label={t(sized ? 'big_pairs' : 'big_units')}
            value={formatNumber(m.pairsSold, locale)}
          />
        </section>

        <section data-testid="cash-block" className="border-hair rounded-xl border bg-white p-3">
          <h3 className="font-display mb-2 text-sm font-medium">{t('cash_title')}</h3>
          <Row
            label={t('cash_revenue')}
            value={formatCurrency(m.revenue, locale, currency)}
            sign="+"
          />
          <Row
            label={t('cash_purchases')}
            value={formatCurrency(m.purchases, locale, currency)}
            sign="−"
          />
          <Row
            label={t('cash_expenses')}
            value={formatCurrency(m.expenses, locale, currency)}
            sign="−"
          />
          <Row
            label={t('cash_in_pocket')}
            value={formatCurrency(m.inPocket, locale, currency)}
            sign="="
            bold
          />
        </section>

        <section data-testid="profit-block" className="border-hair rounded-xl border bg-white p-3">
          <h3 className="font-display mb-2 text-sm font-medium">{t('profit_title')}</h3>
          <Row
            label={t('profit_gross')}
            value={formatCurrency(m.grossProfit, locale, currency)}
            sign="+"
          />
          <Row
            label={t('profit_expenses')}
            value={formatCurrency(m.expenses, locale, currency)}
            sign="−"
          />
          <Row
            label={t('profit_net')}
            value={formatCurrency(m.netProfit, locale, currency)}
            sign="="
            bold
          />
        </section>
      </main>

      <button
        type="button"
        data-testid="add-expense-fab"
        onClick={() => setExpenseOpen(true)}
        className="bg-accent absolute bottom-20 end-5 inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg"
      >
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        {t('add_expense')}
      </button>

      <Dialog.Root open={expenseOpen} onOpenChange={setExpenseOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30" />
          <Dialog.Content
            data-testid="expense-sheet"
            className="bg-paper fixed inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
          >
            <Dialog.Title className="font-display text-lg font-medium">
              {tExpense('title')}
            </Dialog.Title>

            <div data-testid="expense-categories" className="mt-3 flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`expense-cat-${c}`}
                  aria-pressed={expCategory === c}
                  onClick={() => setExpCategory(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${expCategory === c ? 'border-accent bg-accent-soft' : 'border-hair bg-white'}`}
                >
                  {tExpense(`category_${c}`)}
                </button>
              ))}
            </div>

            <input
              data-testid="expense-amount"
              type="text"
              inputMode="decimal"
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              placeholder={tExpense('amount', { currency })}
              className="border-hair mt-3 w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
            />
            <input
              data-testid="expense-note"
              type="text"
              value={expNote}
              onChange={(e) => setExpNote(e.target.value)}
              placeholder={tExpense('note')}
              className="border-hair mt-2 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
            />

            <RadioGroup.Root
              data-testid="expense-recurring"
              value={expRecurring}
              onValueChange={(v) => setExpRecurring(v as RecurringPeriod)}
              className="mt-3 grid grid-cols-3 gap-2"
            >
              {(['none', 'weekly', 'monthly'] as const).map((r) => (
                <RadioGroup.Item
                  key={r}
                  value={r}
                  data-testid={`recurring-${r}`}
                  className="data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft border-hair rounded-lg border bg-white py-2 text-xs"
                >
                  {tExpense(`recurring_${r}`)}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="expense-cancel"
                onClick={() => setExpenseOpen(false)}
                className="border-hair flex-1 rounded-xl border bg-white py-3 text-sm"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                data-testid="expense-save"
                onClick={() => void saveExpense()}
                className="bg-ink flex-1 rounded-xl py-3 text-sm text-white"
              >
                {tCommon('save')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ScreenLayout>
  );
}

function BigNumber({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div data-testid={testId} className="border-hair rounded-xl border bg-white p-3">
      <div className="text-ink-3 font-mono text-[9.5px] uppercase tracking-widest">{label}</div>
      <div className="font-display mt-1 text-lg font-semibold tabular-nums" dir="ltr">
        {value}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  sign,
  bold,
}: {
  label: string;
  value: string;
  sign: '+' | '−' | '=';
  bold?: boolean;
}): JSX.Element {
  return (
    <div className="text-ink-2 flex items-baseline justify-between text-sm">
      <span>{label}</span>
      <span className={`font-mono tabular-nums ${bold ? 'font-semibold' : ''}`} dir="ltr">
        {sign === '+' ? '+' : sign === '−' ? '−' : ''} {value}
      </span>
    </div>
  );
}
