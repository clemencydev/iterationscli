# Storage: staying on Supabase vs moving to DynamoDB

Prices checked 2026-11-18 against the providers' own pages (links at the end).
US East (N. Virginia) for AWS. Where a figure could not be confirmed from a
provider page it is marked *unverified*.

## Bottom line

- **$0 is achievable on both, with different catches.** Supabase Free pauses a
  project after a week without activity and has no backups. DynamoDB's
  always-free allowance does not pause or expire, but only covers
  *provisioned* tables, and the app's data has to be reshaped first.
- **DynamoDB is the more durable free option; it is not the cheaper option at
  scale.** For a write-heavy autosaving app, 1,000 active users cost about the
  same on DynamoDB as Supabase Pro's flat $25.
- **Neither holds the new media files as-is.** Images, video and audio need
  object storage whichever database is chosen. That is the decision that
  actually sets the bill.
- **Recommendation:** move to DynamoDB (provisioned 25/25) plus object storage
  for media, done at the point media sync is built, because the data model has
  to change then anyway. If $25/month is acceptable, Supabase Pro is the
  no-rewrite alternative and covers everything including 100 GB of media.

## What the app stores today

| Thing | Where | Size |
| --- | --- | --- |
| Accounts | `iterations.users` (own bcrypt + JWT auth, not Supabase Auth) | bytes |
| Workspace | one `jsonb` row per account in `iterations.workspaces`, rewritten whole 1.2 s after every change | up to 4 MB (`MAX_BYTES`), grows with each checkpoint |
| Legacy board | `boards`, `columns`, `tickets` (used by `/dashboard`) | small |
| Imported files (new) | the browser only (IndexedDB); not synced | whatever the device allows |

All database access goes through `lib/supabase/client.ts` from nine server
route files, so the surface to change is small.

## Free tiers side by side

| | Supabase Free | AWS always-free |
| --- | --- | --- |
| Database | 500 MB per project | DynamoDB: 25 GB |
| Throughput | not metered | 25 WCU + 25 RCU, **provisioned mode only** (on-demand tables get only the free storage) |
| File storage | 1 GB, 50 MB per file | S3 has no always-free allowance (new accounts: credits only) |
| Egress | 5 GB (+5 GB cached) | 100 GB/month across AWS |
| Backups | none | none included; PITR $0.20/GB-month, on-demand backup $0.10/GB-month |
| Inactivity | **paused after 1 week** | never |
| Projects | 2 active | n/a |
| Runs out | never, but hard caps stop service | never, but anything over the allowance is billed |

Two things about AWS accounts matter here:

- An account opened **on or after 2025-07-15** starts on a Free plan with up
  to $200 in credits that ends after six months or when the credits run out.
  To keep the account you upgrade to the Paid plan (card on file). The
  always-free allowances continue to apply afterwards, so the bill stays $0
  inside them, but nothing stops it going above. Set an AWS Budgets alert.
- An account opened before that date keeps the legacy free tier, including
  always-free.

## What each one costs

Assumptions: granular DynamoDB items (see the next section); media in object
storage; a "heavy" user makes about 2,000 small writes a day.

| Scenario | Supabase Free | Supabase Pro | DynamoDB + S3 | DynamoDB + Cloudflare R2 |
| --- | --- | --- | --- | --- |
| You and a few users, JSON only (today) | $0, pauses if unused for a week | $25 | $0 | $0 |
| Same, plus 5 GB of media, 10 GB egress | not possible (1 GB cap, 50 MB per file) | $25 | about $0.12 (5 GB × $0.023 *unverified*) | $0 (10 GB free) |
| 1,000 active users, 50 GB media, 200 GB egress | not possible | $25 (within 8 GB / 100 GB / 250 GB) | about $22: 25 extra WCU ≈ $12, S3 ≈ $1, 100 GB billable egress ≈ $9 (at $0.09/GB, *unverified*) | about $13: 25 extra WCU ≈ $12, 40 GB × $0.015 ≈ $0.60, egress free |

On-demand DynamoDB instead of provisioned, at the 1,000-user row: roughly 60 M
writes × $0.625/M ≈ $37 plus reads, so more than Supabase Pro. The provisioned
rate used above ($0.00065 per WCU-hour) is from secondary sources and
*unverified*.

Supabase Pro overages, for reference: database $0.125/GB past 8 GB, storage
$0.0213/GB past 100 GB, egress $0.09/GB past 250 GB, $0.00325 per MAU past
100,000. Point-in-time recovery is a $100/month add-on; daily backups (7 days)
are included.

## Limits that bite this app

**Supabase**

- The one-week pause is the real stability problem on Free: a personal project
  left alone for a week stops answering until it is restored by hand. A
  scheduled request every few days avoids it, which is a workaround, not a
  guarantee.
- No backups on Free. The only copy outside the database is each browser's
  `localStorage` and manual "Export workspace JSON".
- 500 MB of database is about 2,000 workspaces at 250 KB, fewer as checkpoints
  pile up (each one embeds a full snapshot).
- 1 GB of storage and 50 MB per file rule out syncing video.

**DynamoDB**

- **An item cannot exceed 400 KB.** The workspace document is allowed to reach
  4 MB, so it cannot be moved as one item.
- **Writes are charged per KB.** Saving a 200 KB workspace costs 200 write
  units. At 25 WCU that is one save every 8 seconds once the burst allowance is
  spent; on-demand it is $0.000125 per save, about $0.15 per user for an hour
  of editing that saves every 3 seconds.
- So the workspace has to become many small items: one per ticket, canvas
  item, stroke, file, folder and checkpoint (key `user#<id>` + `task#<id>` and
  so on), with only the changed items written. Checkpoint snapshots, the
  largest part, belong in object storage with a pointer item. That turns a save
  into 1–3 write units and makes 25 WCU ample: 25 writes a second is about
  2 million a day.
- No joins or ad-hoc queries; every access pattern is designed up front. The
  current patterns (load a user by name, load and save one user's workspace)
  fit it well.
- No file storage or hosted auth in the box. Auth is already the app's own, so
  only files need another service.

**Either way: media**

File bytes are local-only today. Syncing them needs object storage: Supabase
Storage (only practical on Pro), S3 ($0.023/GB-month *unverified*, no
always-free allowance, 100 GB egress free), or Cloudflare R2 (10 GB free,
$0.015/GB-month after, no egress charge). R2 speaks the S3 API, so the code is
the same for both.

## What a move involves

1. Put an interface in front of storage (`getUser`, `createUser`,
   `loadWorkspace`, `saveChanges`, …) and make the nine route files use it
   instead of the Supabase client. Worth doing even if nothing moves.
2. Change sync from "PUT the whole workspace" to "send what changed". The
   client already knows each change (`commit` in `Workspace.tsx`).
3. Implement the interface on DynamoDB with the AWS SDK from the same Next.js
   routes; IAM keys in the environment, no VPC or Lambda needed.
4. Add signed-URL upload and download for file bytes (S3 or R2), and have
   `lib/file-store.ts` fall back to it when a file is not on the device.
5. One-off copy of existing rows; keep Supabase read-only until checked.

Steps 2 and 4 are the bulk of it and are needed for media sync regardless of
the database.

## Sources

- Supabase pricing: https://supabase.com/pricing
- DynamoDB on-demand pricing and free tier: https://aws.amazon.com/dynamodb/pricing/on-demand/
- AWS Free Tier change of 2025-07-15: https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/
- S3 pricing (egress allowance, free-tier wording): https://aws.amazon.com/s3/pricing/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
