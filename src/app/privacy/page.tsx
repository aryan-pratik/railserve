export const metadata = {
  title: 'Privacy Policy — RailServe',
}

/** Required by Google Cloud's OAuth consent screen Branding page to publish
 * the app out of Testing — RailServe's Gmail integration reads a single
 * internal order-ingestion mailbox, not end-user mail. */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh justify-center bg-canvas p-6">
      <article className="w-full max-w-2xl py-12 text-ink">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="mt-1 text-sm text-muted">Last updated 2026-09-09</p>

        <p className="mt-6 text-sm leading-relaxed">
          RailServe is an internal operations tool for train food delivery outlets. This page
          describes how it uses the Google account data it accesses.
        </p>

        <h2 className="mt-8 text-lg font-medium">Gmail access</h2>
        <p className="mt-2 text-sm leading-relaxed text-pretty">
          RailServe connects, with read-only access, to a single dedicated mailbox
          (<code>bitestation0001@gmail.com</code>) that exists solely to receive order
          confirmation emails from food-delivery aggregators. It does not access any other
          Google account, and it does not send, delete, or modify email. Emails are parsed to
          create and track orders inside RailServe; the aggregator email content (order ID,
          items, outlet, amount) is stored in RailServe&apos;s own database for that purpose only.
        </p>

        <h2 className="mt-8 text-lg font-medium">What is not done with this data</h2>
        <p className="mt-2 text-sm leading-relaxed text-pretty">
          Email content is never sold, shared with advertisers, or used for any purpose beyond
          creating and fulfilling orders within RailServe.
        </p>

        <h2 className="mt-8 text-lg font-medium">Contact</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Questions about this policy: <code>bitestation0001@gmail.com</code>.
        </p>
      </article>
    </main>
  )
}
