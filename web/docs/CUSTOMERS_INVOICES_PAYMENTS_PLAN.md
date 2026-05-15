# Inventar: Customer Master + Invoice Payments Plan

This is the next safe product layer after the Settings cleanup.

## Core principle

Invoice issued is not the same as money received.

- **Invoice amount** = money expected
- **Payment amount** = money received
- **Balance due** = money still owed

Stock should decrease when the sale/invoice is issued, because the product left the shop. Cash/dashboard revenue should increase only when a payment is recorded.

## Product structure

Inventar should evolve to:

1. Product master
2. Customer master
3. Sale / invoice creation
4. Payment ledger
5. Reports/dashboard
6. Shop Identity settings

## Customer master

Minimum customer fields:

- customer type: individual/company
- display name
- legal name
- phone / WhatsApp
- email
- billing address
- city
- country
- tax/fiscal ID
- notes
- invoice history
- outstanding balance

## Sale / invoice flow

1. Open Sale
2. Choose customer:
   - walk-in / anonymous
   - existing customer
   - quick-add customer
3. Choose products from saved product master
4. Choose quantity, color, size
5. Resolve VAT/tax:
   - invoice-line override
   - product tax setting
   - shop default VAT
   - fallback 0%
6. Issue invoice
7. Record payment state:
   - unpaid
   - paid now
   - partial payment
8. Save payment record if money is received
9. Dashboard updates from payment ledger

## Payment status

An invoice can be:

- unpaid
- partially_paid
- paid
- overdue
- cancelled
- refunded

Use a payment ledger, not just a checkbox. A customer may pay one invoice in multiple payments.

## Dashboard cards

Dashboard should separate:

- invoices issued today
- cash received today
- outstanding customer debt
- partial payments
- overdue invoices
- top products
- low stock

## Settings decision

Do not keep a duplicate visible Invoicing/Facture settings section if Shop Identity already stores seller information.

Seller invoice information should live in Shop Identity:

- legal business name
- tax/fiscal ID
- address/contact fields
- default VAT %

Invoice generation should use Shop Identity for the seller block and Customer Master snapshots for the buyer block.

## Implementation order

1. Add Customer Master data model and Dexie table.
2. Add Customer list/detail screens.
3. Add customer picker and quick-add from Sale.
4. Add invoice customer snapshot.
5. Add payment records table.
6. Add payment status badges to invoice list/detail.
7. Add paid/partial/unpaid flow after invoice issue.
8. Update dashboard to use payments for cash received.

Do not implement all of this inside Settings. Settings only stores the merchant's own identity and defaults.
