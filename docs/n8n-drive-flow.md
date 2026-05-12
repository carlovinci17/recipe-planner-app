# n8n: Google Drive → Recipe Planner

A reference n8n flow that watches a Drive folder and pushes new files into the
Recipe Planner ingestion pipeline. The Inngest cron poller is a fallback when
this flow isn't configured.

## Nodes

1. **Google Drive Trigger**
   - Resource: File
   - Event: `fileCreated`
   - Folder: pick the folder the household has registered as "watched"

2. **HTTP Request**
   - Method: `POST`
   - URL: `{{ $env.RECIPE_PLANNER_URL }}/api/webhooks/drive`
   - Authentication: header `x-webhook-secret = {{ $env.RECIPE_PLANNER_WEBHOOK_SECRET }}`
   - Body (JSON):
     ```json
     {
       "householdId": "{{ $env.HOUSEHOLD_ID }}",
       "accountId": "{{ $env.INTEGRATION_ACCOUNT_ID }}",
       "driveFileId": "{{ $json.id }}",
       "mimeType": "{{ $json.mimeType }}",
       "fileName": "{{ $json.name }}"
     }
     ```

## Variables to set in the n8n environment

- `RECIPE_PLANNER_URL` — the deployed app URL.
- `RECIPE_PLANNER_WEBHOOK_SECRET` — must match `N8N_WEBHOOK_SECRET` in the app env.
- `HOUSEHOLD_ID` — the household this flow targets.
- `INTEGRATION_ACCOUNT_ID` — the `integration_accounts.id` row id created by the
  in-app OAuth flow (Settings → Integrations → Connect Google Drive).

## Why both n8n and Inngest cron?

- n8n gives near-real-time triggering when configured; latency is a few seconds.
- Inngest cron polls every 10 minutes via the Drive Changes API. It costs almost
  nothing and works without n8n. If n8n breaks, ingestion still happens.

The two paths are deduplicated by the storage upload step — both ultimately
create the same `ingestion_jobs` row keyed by Drive file id and emit the same
`ingestion/file.uploaded` event.
