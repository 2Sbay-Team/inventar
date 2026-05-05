# Inventar — Non-Goals

This document is the firewall against scope creep. Anything listed here is **deliberately out of scope** for v1.0. If a feature here turns out to be essential, it gets re-litigated as an ADR change, not silently added during implementation.

---

## Out of scope for v1.0

### Connectivity and accounts

- **Multi-device sync.** Each install is independent. The data model is forward-compatible if Phase 2 ever adds it back; not now.
- **Cloud backup.** Settings → Export Data covers manual backup. No automatic upload anywhere.
- **User accounts.** No email, no password, no signup, no login screen. The shop name is the only identity.
- **Pairing codes.** Without sync, there is nothing to pair into.
- **Multi-tenant server.** No server. No tenants in any architectural sense.

### Commerce features

- **Customer database.** No "who bought what". Sales are anonymous.
- **Invoices, receipts, or printable documents** of any kind.
- **Sales tax computation, VAT.** Prices are stored as the merchant types them.
- **Loyalty programs, discounts, coupons, vouchers.**
- **Online ordering / e-commerce storefront.** This is an internal tool, not a customer-facing site.
- **Payment processing.** Cash-only; no integration with any payment service provider.
- **Refunds workflow with money tracking.** Returns adjust stock; cash flow is the merchant's mental note.

### Inventory features

- **Barcode scanning.** Many of the target users' items have no barcode; designing for barcodes optimises for the wrong case.
- **AI-based photo recognition** to autofill name/category. Phase 3 if validated demand.
- **Multi-store / multi-warehouse / location tracking.** One install = one shop.
- **Supplier database, supplier-specific pricing.** Brand free-text is enough.
- **Purchase orders, stock requests, automated reorder.**
- **Bundles or kits** (e.g. "shoe + shoe-care kit at one price").

### Notifications & automation

- **Push notifications.** No "low stock" alerts, no "you sold 5 pairs today" pings.
- **Email or SMS to anyone.** Not even the merchant.
- **Scheduled reports.**
- **Webhooks or Zapier-style integrations.**

### Smart / AI features

- **Price recommendation.** Don't suggest raising or lowering prices.
- **Demand forecasting.** Don't predict sell-through.
- **Auto-categorisation** of new articles from photos.
- **Voice input** for adding articles.
- **Chat assistant** ("hey app, do I have white 42?"). Search is the answer.

### Localisation

- **More than three locales.** FR, AR, EN only.
- **Multi-currency.** TND only.

### Platform

- **Native iOS or Android app.** PWA only. ADR-001.
- **Trusted Web Activity APK build.** A nice-to-have for sideload distribution; one-day add post-MVP if requested.
- **Apple Watch / Wear OS companion.**

### Reports & analytics

- **CSV export per period.** JSON export covers the use case.
- **Custom report builder.**
- **Comparative reports** ("this month vs last month") — period selector covers the basics.
- **Cohort analysis, retention curves.**

### Operational

- **Self-service signup with billing.** No signup at all; the URL is the install.
- **In-app subscription management.**
- **Public marketing site.** A simple `/about` page is the maximum.
- **Telemetry, analytics tracking, error reporting back to the code owner.** No data ever leaves the device. The user's phone is the entire system.

---

## Things that *sound* in scope but aren't

| Asked for | Why deferred |
|---|---|
| "Show me which items are most profitable" | Phase 2. Dashboard shows top sellers; profit-per-article ranking is Phase 2. |
| "Send a daily summary to my phone" | No notifications in v1. ADR-007. |
| "Print barcodes for my shop" | No printer integration; barcodes don't fit a no-SKU supply chain. |
| "Sync to Google Sheets / Excel" | JSON export covers it; spreadsheet integrations are Phase 3+. |
| "Let my employee log sales without seeing prices" | No multi-user. Out of scope. |
| "Back up automatically to my Drive" | Requires OAuth and account linking; deliberately avoided. |
| "Run on multiple phones at once" | No sync. ADR-003. |

---

## Scope-creep guard

When a request arrives mid-implementation that isn't explicitly in `SPEC.md`, the default answer is: **document it in this file under "out of scope" and ship the MVP**.

The only valid path to add something during implementation:

1. Stop work on the affected area.
2. Write a one-paragraph justification.
3. Either update `SPEC.md` and a relevant ADR, or extend `NON_GOALS.md` with the new item.
4. Resume work.
