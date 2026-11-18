# WhatsApp reminders: templates and set-up (A9)

The WhatsApp Business Platform (Meta Cloud API) only lets a business start a conversation with an approved **message template**. These are the templates the code sends (`public.whatsapp_notification_types`). Submit them in Meta's WhatsApp Manager exactly as written: category **Utility**, language **English**.

| Template name | Used for | Body (submit this text) | Sample values for Meta's review |
| --- | --- | --- | --- |
| `futty_game_reminder` | `match_reminder_24h`, `match_reminder_2h` | `Futty reminder. {{1}}: {{2}} Open Futty to see who's in and who's paid. Reply STOP to stop these reminders.` | {{1}} `Kick-off in 2 hours`; {{2}} `North Arena at 20:00. 6 in, 2 haven't paid.` |
| `futty_after_game` | `match_after_game` | `How did it go? Confirm the score, vote for man of the match and rate the players in Futty. Reply STOP to stop these reminders.` | none |

{{1}} is the notification's title and {{2}} its body, the same words the push shows. (Meta refuses a template that starts or ends with a parameter, which is why the text starts "Futty reminder.") If Meta asks for changes, the template name and the number and order of the {{n}} parameters must stay the same, or `whatsapp_notification_types` has to change in a migration.

**Not included yet:** an "unpaid spot" alert for the booker (05 section 13). No notification type sends one today. The 24-hour and 2-hour reminders already say "2 haven't paid". A new type for it is a product decision, made before it gets a template.

## Set-up checklist (Panos)

1. Create a WhatsApp Business account in Meta Business Manager, add and verify a business phone number, and verify the business.
2. Submit both templates above. Wait for approval.
3. **Check the price per message for Cyprus (05 section 13)** on Meta's pricing page. Utility templates are billed per message delivered. Add the price with a migration, in micro-euros (1/1,000,000 of a euro):
   `insert into public.whatsapp_prices (country_code, category, price_micros, valid_from) values ('357', 'utility', <price>, '<date>');`
   Until a price is set, every message's category is still logged and `whatsapp_costs_by_month` shows it under `not_priced`.
4. Create a permanent System User token with `whatsapp_business_messaging`, and set the secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (and optionally `WHATSAPP_GRAPH_VERSION`, default `v21.0`).
5. Deploy `notify-send-whatsapp` and `whatsapp-webhook` (instructions at the bottom of each `index.ts`), schedule `notify-send-whatsapp` every minute, and subscribe the webhook to the `messages` field.
6. Switch WhatsApp on: `update public.whatsapp_settings set enabled = true;`. Until then players can't see or choose it, and everything goes by push.

## How much it costs

`select * from public.whatsapp_costs_by_month;` (service role): messages, delivered, read, failed and cost per month, by type and pricing category.
