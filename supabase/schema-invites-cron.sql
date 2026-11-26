-- 1LinkTrip: invitation emails over the day's allowance go out by themselves the next day. Run after schema-invites.sql.
-- Every 15 minutes, IF an invitation email is queued and due, pg_cron asks the notify function to send what's due
-- (kind "drain"). The call carries the cron secret (header x-cron-secret), which notify checks against its
-- NOTIFY_CRON_SECRET; the secret lives in Vault (name 'notify_cron_secret'), never in this file.
--
-- Once:  select vault.create_secret('<the same random string as NOTIFY_CRON_SECRET>', 'notify_cron_secret');
--        select vault.create_secret('<the project's anon key, a JWT>', 'notify_anon_jwt');  (public; only so the gateway lets the call in)
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'invite-drain') then perform cron.unschedule('invite-drain'); end if;
end $$;

select cron.schedule('invite-drain', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://mljzoujystouqkmmoemn.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notify_anon_jwt'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_cron_secret')),
    body := '{"kind":"drain"}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.invite_sends where status = 'queued' and not_before <= now())
    and exists (select 1 from vault.decrypted_secrets where name = 'notify_cron_secret')
$cron$);
