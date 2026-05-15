import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Plus, Search, Trash2, Users } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { archiveCustomer, listCustomers, upsertCustomer } from '../repos/customers';
import { type Customer, type CustomerType } from '../types';

interface CustomerDraft {
  id?: string;
  type: CustomerType;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  fiscal_id: string;
  notes: string;
}

const EMPTY_DRAFT: CustomerDraft = {
  type: 'individual',
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  country: '',
  fiscal_id: '',
  notes: '',
};

function draftFromCustomer(c: Customer): CustomerDraft {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    country: c.country ?? '',
    fiscal_id: c.fiscal_id ?? '',
    notes: c.notes ?? '',
  };
}

export function CustomersScreen(): JSX.Element {
  const { t } = useTranslation('customers');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const customers = useLive(() => listCustomers(db), [], []);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return customers;
    return customers.filter((c) => c.search_blob.includes(q));
  }, [customers, query]);

  async function saveDraft(): Promise<void> {
    if (!draft || draft.name.trim().length === 0) return;
    setSaving(true);
    try {
      await upsertCustomer(db, draft);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer(id: string): Promise<void> {
    if (!window.confirm(t('delete_confirm'))) return;
    await archiveCustomer(db, id);
  }

  return (
    <ScreenLayout wide>
      <header className="border-hair sticky top-0 z-20 flex items-center gap-3 border-b bg-paper/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          aria-label={tCommon('back')}
          onClick={() => navigate(-1)}
          className="text-ink-3 -ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ChevronLeft aria-hidden className="h-6 w-6 rtl:rotate-180" strokeWidth={2.25} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-xl font-semibold text-ink">{t('title')}</h1>
          <p className="text-ink-3 text-xs">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          data-testid="customer-add"
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="bg-accent inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-white"
        >
          <Plus aria-hidden className="h-4 w-4" />
          {t('add')}
        </button>
      </header>

      <main className="space-y-4 px-4 py-4 pb-24">
        <section className="rounded-2xl border border-accent/20 bg-accent-soft/30 p-4">
          <div className="flex items-start gap-3">
            <Users aria-hidden className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
            <div>
              <h2 className="font-display text-sm font-semibold text-ink">{t('why_title')}</h2>
              <p className="text-ink-2 mt-1 text-xs leading-relaxed">{t('why_body')}</p>
            </div>
          </div>
        </section>

        <div className="relative">
          <Search
            aria-hidden
            className="text-ink-3 absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          />
          <input
            data-testid="customers-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            className="border-hair text-ink placeholder:text-ink-3 w-full rounded-2xl border bg-white py-3 pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-4/60 bg-white p-6 text-center">
            <Users aria-hidden className="text-ink-4 mx-auto h-10 w-10" />
            <h2 className="font-display mt-3 text-sm font-semibold text-ink">
              {query.trim() ? t('empty_search') : t('empty_title')}
            </h2>
            <p className="text-ink-3 mt-1 text-xs leading-relaxed">
              {query.trim() ? t('empty_search_hint') : t('empty_hint')}
            </p>
          </div>
        ) : (
          <ul data-testid="customers-list" className="grid gap-2 md:grid-cols-2">
            {filtered.map((customer) => (
              <li key={customer.id} className="rounded-2xl border border-hair bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    data-testid={`customer-edit-${customer.id}`}
                    onClick={() => setDraft(draftFromCustomer(customer))}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-display truncate text-sm font-semibold text-ink">
                        {customer.name}
                      </span>
                      <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[10px] font-medium text-ink-3">
                        {t(`type_${customer.type}`)}
                      </span>
                    </div>
                    <p className="text-ink-3 mt-1 truncate text-xs">
                      {[customer.phone, customer.email, customer.city]
                        .filter(Boolean)
                        .join(' · ') || t('no_contact')}
                    </p>
                    {customer.fiscal_id ? (
                      <p className="text-ink-3 mt-1 truncate text-[11px]">
                        {t('fiscal_id_short')}: {customer.fiscal_id}
                      </p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={tCommon('delete')}
                    onClick={() => void removeCustomer(customer.id)}
                    className="text-bad/80 hover:text-bad inline-flex h-9 w-9 items-center justify-center rounded-full"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className="rounded-2xl border border-hair bg-white p-4">
          <h2 className="font-display text-sm font-semibold text-ink">{t('walk_in_title')}</h2>
          <p className="text-ink-3 mt-1 text-xs leading-relaxed">{t('walk_in_body')}</p>
          <Link to="/sale" className="text-accent mt-3 inline-flex text-sm font-medium">
            {t('go_to_sale')} →
          </Link>
        </section>
      </main>

      {draft ? (
        <div className="fixed inset-0 z-[120] bg-black/30 p-3 backdrop-blur-sm sm:flex sm:items-center sm:justify-center">
          <form
            data-testid="customer-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
            className="max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-3xl bg-paper p-4 shadow-2xl sm:w-full sm:max-w-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {draft.id ? t('edit_title') : t('new_title')}
                </h2>
                <p className="text-ink-3 text-xs">{t('form_hint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-ink-3 rounded-full px-2 py-1 text-sm"
              >
                {tCommon('close')}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-ink-2 text-xs font-medium">{t('name')}</span>
                <input
                  autoFocus
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="border-hair text-ink placeholder:text-ink-3 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
                  placeholder={t('name_placeholder')}
                />
              </label>

              <div className="sm:col-span-2 flex gap-2 rounded-xl bg-white p-1">
                {(['individual', 'company'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDraft({ ...draft, type })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                      draft.type === type ? 'bg-accent text-white' : 'text-ink-3'
                    }`}
                  >
                    {t(`type_${type}`)}
                  </button>
                ))}
              </div>

              <CustomerInput
                label={t('phone')}
                value={draft.phone}
                onChange={(phone) => setDraft({ ...draft, phone })}
                placeholder="+216 98 765 432"
              />
              <CustomerInput
                label={t('email')}
                value={draft.email}
                onChange={(email) => setDraft({ ...draft, email })}
                placeholder="customer@example.com"
              />
              <CustomerInput
                label={t('address')}
                value={draft.address}
                onChange={(address) => setDraft({ ...draft, address })}
                placeholder={t('address_placeholder')}
                wide
              />
              <CustomerInput
                label={t('city')}
                value={draft.city}
                onChange={(city) => setDraft({ ...draft, city })}
                placeholder={t('city')}
              />
              <CustomerInput
                label={t('country')}
                value={draft.country}
                onChange={(country) => setDraft({ ...draft, country })}
                placeholder={t('country')}
              />
              <CustomerInput
                label={t('fiscal_id')}
                value={draft.fiscal_id}
                onChange={(fiscal_id) => setDraft({ ...draft, fiscal_id })}
                placeholder={t('fiscal_id_placeholder')}
                wide
              />
              <label className="space-y-1 sm:col-span-2">
                <span className="text-ink-2 text-xs font-medium">{t('notes')}</span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  className="border-hair text-ink placeholder:text-ink-3 min-h-20 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
                  placeholder={t('notes_placeholder')}
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving || draft.name.trim().length === 0}
                className="bg-accent flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? tCommon('saving') : tCommon('save')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </ScreenLayout>
  );
}

function CustomerInput({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  wide?: boolean;
}): JSX.Element {
  return (
    <label className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-ink-2 text-xs font-medium">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-hair text-ink placeholder:text-ink-3 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
      />
    </label>
  );
}
