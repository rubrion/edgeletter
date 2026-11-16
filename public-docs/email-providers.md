# Email

All mail goes through **Resend** from the platform's own sending domain (`MAIL_FROM_DOMAIN`):

- **Campaigns**: `Publication Name <posts@mail.edgeletter.blog>`, Reply-To set to the owner, sent through the batch API from the queue consumer.
- **Confirmations**: `confirm@`.
- **Sign-in links**: `signin@`.
- **Invitations**: `invites@`.

Keeping sending on a dedicated subdomain isolates the platform's reputation from any company domain.

## Deliverability

- Verify the sending domain in Resend: DKIM CNAMEs, SPF and a DMARC record.
- Every campaign carries `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, a plain-text part, and a "Report abuse" link.
- The Resend webhook fills `email_suppressions` with hard bounces and complaints. Suppressed addresses are skipped when publishing, at send time, on import and on subscribe.
- New publications are capped at 500 emails in their first week; monthly caps follow the plan.
