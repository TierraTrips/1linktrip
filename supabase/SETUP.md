# 1LinkTrip on Supabase: owner setup

You need about five minutes in the Supabase dashboard. You don't need to send anything back: 1LinkTrip already has the project URL and the publishable key. Never share the secret (service_role) key. 1LinkTrip doesn't use it.

## 1. Create the tables

1. Open **SQL Editor → New query**.
2. Paste the whole of `schema.sql` and click **Run**.
3. You should see "Success. No rows returned". It's safe to run again later.

This creates three tables (`events`, `rsvps`, `announcements`) with Row Level Security:

- Anyone can read published pages and their announcements.
- Only the signed-in owner can create, edit or delete their own pages and announcements.
- Anyone can send an RSVP to a published page. Only that page's owner can read the replies.

Your project has **"Automatically expose new tables" off**, so the script also adds explicit `GRANT`s for the `anon` and `authenticated` roles. Without those grants the app gets "permission denied" errors even with the policies in place. The tables use uuid ids, so there are no sequences to grant.

## 2. Turn on email sign-in (magic link)

1. Open **Authentication → Sign In / Providers**.
2. Make sure **Email** is enabled.

Organizers sign in with a one-time link sent to their email. There are no passwords.

The built-in email sender is rate-limited, so it's fine for testing. Before real use, add your own SMTP under **Authentication → Emails → SMTP Settings**. Check the current limit on your plan in the dashboard.

## 3. Allow the site's address for sign-in links

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://1linktrip.com`
3. Under **Redirect URLs**, add `https://1linktrip.com/**` and `https://www.1linktrip.com/**`. Keep `https://bbbot0209.github.io/eventpages/**` too (the old address still works).

Step-by-step version with Copy buttons: https://bbbot0209.github.io/eventpages/setup/#step4

## Check (optional)

1. Open **Table Editor**. You should see `events`, `rsvps` and `announcements`, each marked "RLS enabled".
2. Open **Database → Roles**. You don't need to change anything there.
3. Open **Settings → Data API**. **Exposed schemas** should include `public` (the default).
