# Agent guide for MijnTaal

## Purpose and starting points

MijnTaal is a personal Dutch learning studio with English translations. Preserve this scope and existing learning data. These are shared repository instructions, not a place for session logs, personal preferences, account details or deployment identities.

Read [README.md](README.md) for setup, [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for the source map and [CONTRIBUTING.md](CONTRIBUTING.md) for contribution conventions. Read only the additional documentation relevant to the task:

- [docs/SITES.md](docs/SITES.md): hosting, staging, secrets and deployment.
- [docs/MCP.md](docs/MCP.md): the chat-facing material tools.
- [docs/DICTIONARY.md](docs/DICTIONARY.md): pinned dictionary sources, SQLite preparation and generated bilingual JSON assets.
- [docs/PRACTICE.md](docs/PRACTICE.md): user-facing practice goals, flows and scheduling rules. Keep it aligned with behavior changes.
- [SECURITY.md](SECURITY.md): authentication and private data boundaries.

## Architecture

- React with Next-style App Router files, built by **Vinext on Vite** for a **Cloudflare Worker**. Preserve the Sites integration; do not replace the runtime with a plain Next.js server or static export.
- `app/page.tsx` coordinates Search, Collection, Practice and Settings. `app/texts/page.tsx` selects Texts in the same application; avoid duplicating the app.
- `app/components/` contains feature UI; `app/globals.css` contains shared styling and responsive rules.
- `app/api/*/route.ts` and `app/mcp/route.ts` share `lib/server/` services. Keep browser and MCP validation and ownership rules consistent.
- Plain phrase/sentence translation tries Azure first, with OpenAI fallback when configured. Grammar and dictionary enrichment remain on OpenAI; keep provider readiness and caches separate.
- `lib/` holds dictionary, learning, journaling and audio logic; `db/schema.ts` and `drizzle/` define persisted data. Sites binds D1 as `DB` and R2 as `BUCKET`.

## Local setup and checks

Use Node.js 24 and the pnpm version pinned in `package.json`. Install with `pnpm install --frozen-lockfile`; preserve the lockfile and dependency release-age policy.

On a fresh clone only, copy `.openai/hosting.example.json` to `.openai/hosting.json`. Never overwrite an existing installation manifest. Then run:

```sh
pnpm build
pnpm db:local
pnpm dev -- --hostname 127.0.0.1
```

Use `/signin-with-chatgpt?return_to=/` for the loopback-only development identity. Build before initializing local D1. `pnpm start` runs the built Worker and does not simulate sign-in. Do not expose the development identity beyond loopback.

Before handing off code changes, run the applicable checks:

```sh
pnpm check:public
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For documentation-only changes, formatting and the public-source check are normally sufficient. Format changed authored files rather than reformatting unrelated code. Add focused regression coverage for behavior involving data, synchronization or authorization. Several component tests use VM-based React hook harnesses; update those harnesses when changing hooks and assert observable behavior.

Run `pnpm check:public` and the complete `pnpm test` suite from this public source checkout. The staging tests deliberately exercise public-template rules and do not work unchanged in a deployment snapshot that tracks its local hosting manifest.

Dictionary regeneration is explicit: `pnpm dictionary:build --wikdict-dir /path/to/pinned-inputs` uses Python 3 standard-library SQLite, verifies the source lock and generates `public/dictionary/v2` over the unchanged v1 base. Normal builds do not download upstream data. Keep both layers and source attribution together; never hand-edit generated shards.

## Data and provider invariants

- Preserve account isolation, optimistic version checks, exact saved Dutch forms, original text and compatible backup imports/exports.
- Preserve pending practice journals, progress and resumable sessions. Do not reset learning state as part of UI work.
- Scope caches and recordings to their owner, content and provider/voice configuration. Keep text edits and audio invalidation consistent.
- Scope routes through the existing trusted identity and mutation helpers in `lib/server/common.ts`; do not trust browser-supplied owner IDs.
- Append migrations; never rewrite an applied migration. Do not operate on a hosted database to test a local change.
- Use synthetic fixtures and mocked providers in tests. Passing tests does not verify paid provider access, hosted sign-in or real audio playback. Report those verification limits explicitly.
- Never print or commit provider keys, encrypted credential copies, cookies, recordings, backups or local runtime state. Preserve the existing encryption key when updating an installation.

## Interface and assets

Keep the navy-led palette, restrained orange accents, warm neutral surfaces and peach selection states. Reuse semantic CSS tokens, existing components, Lucide icons and `public/brand/` assets. Preserve functional red/green feedback and noun-article distinctions.

Keep desktop navigation visible and mobile navigation collapsed by default into its small edge trigger. The mobile disclosure uses a compact white vertical menu with an active peach row. Preserve outside-click, Escape and destination-selection dismissal, focus behavior, safe-area spacing and reduced-motion support.

For UI changes, check relevant desktop and mobile states, keyboard operation and readable contrast. Distinguish actual browser verification from a successful build; report unavailable browser checks honestly.

## Source and publication boundaries

The public GitHub repository and Sites deployment repository have separate histories. A GitHub push does not deploy the app, and hosted edits do not automatically return here. Reconcile independent hosted changes before replacing hosted source.

For publication, follow [docs/SITES.md](docs/SITES.md). Reuse the intended existing Site identity and audience. Open its deployment source in an empty temporary checkout, then run `pnpm sites:stage --checkout <opened-checkout>` from this public project. Use the authenticated Sites workflow to build, push, save and deploy the matching source/archive; confirm a terminal deployment result.

Keep `.openai/hosting.json`, Site IDs and credentials out of the public repository. The deployment snapshot intentionally tracks its installation manifest; never use its remote as the public GitHub remote. Preserve runtime secrets, database, recordings and audience during updates.

Do not hand-edit dictionary shards in `public/dictionary/`, generated build output or vendored integration files for unrelated changes. Preserve dictionary and third-party license attribution. Keep shared source and documentation in English, and update this guide when commands or architectural constraints change.
