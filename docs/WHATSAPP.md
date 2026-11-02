# WhatsApp chat (telecaller ↔ passenger)

`/calls/chat` lets a telecaller answer a passenger on WhatsApp from the same
console they ring them from; `/admin/chat` is the same screen for an admin,
who sees every outlet's threads and can hand one to a named telecaller. Every thread is one passenger number; the thread
remembers which order it is about and which outlet that order belongs to, and
a telecaller sees only the threads of the outlets they hold (plus any thread no
outlet has claimed yet — a number that wrote in with no order on file).

The transport is **MSG91's WhatsApp Business API**. Nothing here is specific
to MSG91 beyond `src/lib/whatsapp/msg91.ts` and the webhook parser; the
repository talks to the `WhatsAppProvider` interface in
`src/lib/whatsapp/provider.ts`.

## Modes

| `WHATSAPP_PROVIDER` | What happens |
| --- | --- |
| `simulator` (default) | Nothing reaches a phone. Every message a telecaller sends is marked delivered, then read, then answered by a pretend passenger ~1.5 s later. The screen says "Simulated" under its title. |
| `msg91` | Real sends through MSG91. Needs `MSG91_AUTH_KEY` and `MSG91_WHATSAPP_NUMBER`; with either blank the app silently stays in simulator mode. |

## MSG91 setup

1. **Credentials.** In the MSG91 dashboard copy the account **authkey** into
   `MSG91_AUTH_KEY`, the integrated WhatsApp Business number (digits with
   country code, e.g. `9173…`) into `MSG91_WHATSAPP_NUMBER`, and the
   account's template namespace into `MSG91_TEMPLATE_NAMESPACE`.
2. **Webhook.** Generate a token into `MSG91_WEBHOOK_TOKEN`, then in
   *WhatsApp → Webhook (New) → Create Webhook* add

   ```
   https://bitestation.elvo.in/api/whatsapp/webhook?token=<MSG91_WEBHOOK_TOKEN>
   ```

   for **both** inbound messages and outbound reports (sent / delivered /
   read / failed). The token may instead be sent as an `x-webhook-token`
   header, which the dashboard's "custom headers" option allows. MSG91 signs
   nothing, so this token is the whole gate: with none configured the endpoint
   answers 503 and accepts nothing.
3. **Opener template.** WhatsApp lets a business write first only with an
   approved template, and only a template once 24 hours have passed since the
   passenger's last message. Create a *utility* template with one body
   variable (the order id), e.g.

   > Hello, this is BiteStation about your order {{1}}. Reply here and we will
   > help you with it.

   and put its name in `MSG91_OPENER_TEMPLATE` (language code in
   `MSG91_OPENER_TEMPLATE_LANG`, default `en`). `MSG91_OPENER_TEMPLATE_VARS`
   says what fills each body variable in order, from `name`, `order` and
   `outlet` — e.g. `name,order` for "Hi {{1}}, … your order {{2}} …". The
   `support_chat_opener` template created on 2026-11-02 uses exactly that. Without it the "Send opener
   template" button is disabled and a thread can only be answered, never
   started.
4. `npm run indexes` after deploying — the two new collections have unique
   indexes (`waconversations.phone`, `wamessages.providerMessageId`) that the
   webhook relies on for idempotency.

## API contract (verified 2026-11-01)

Free text, inside the 24-hour window:

```
POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/
authkey: <key>
integrated_number, recipient_number, content_type=text, text
```

The reference lists these as query parameters; the group variant takes the
same names as JSON. The client sends both.

Template, any time:

```
POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/
{ "integrated_number": "...", "content_type": "template",
  "payload": { "messaging_product": "whatsapp", "type": "template",
    "template": { "name": "...", "language": { "code": "en", "policy": "deterministic" },
      "to_and_components": [{ "to": ["91…"], "components": { "body_1": { "type": "text", "value": "FT-123" } } }] } } }
```

Webhook (new shape) — one JSON object per event. Inbound carries
`customerNumber`, `customerName`, `contentType`, `text` (or `url`/`caption`
for media), `uuid`, and the raw Meta `messages` array as a JSON string;
outbound reports carry `eventName` (`sent`/`delivered`/`read`/`failed`),
`uuid` (the `wamid`), `requestId` and `reason`. The old snake_case shape
(`customer_number`, `direction: "inbound"`, `message_uuid`, `status`) is
parsed too. Samples live in `tests/whatsapp.test.ts`.

## Rules the screen enforces

- Free text is refused (before the provider is called) when the passenger
  has never written or last wrote more than 24 hours ago. The header pill
  shows the window and how long is left.
- Replying to an unclaimed thread assigns it to the sender. A telecaller can
  *Take* or *Release* a thread; handing it to a named colleague is an admin's
  move (repository only — there is no admin screen yet).
- A webhook replay of the same `wamid` is a no-op. Status reports only move
  forward (a late "delivered" after "read" is ignored); "failed" overrides.
- Nav badge, list and thread refresh themselves from `/api/chat/stream`, an
  SSE feed polling the scoped repository every 3 s, like the store board.
- The rail and the thread scroll like a messaging app rather than paging:
  the rail fetches the next 30 threads from `/api/chat/conversations` as you
  near the bottom, and the thread fetches the 100 messages before the oldest
  one shown from `/api/chat/messages` when you scroll to the top.
- Opening a chat from an order never moves a thread another outlet holds
  into yours; like "New chat" it refuses, so a passenger with orders at two
  stations stays with whichever outlet answered first until an admin
  reassigns. A telecaller can take an unheld thread or release their own,
  not a colleague's.
