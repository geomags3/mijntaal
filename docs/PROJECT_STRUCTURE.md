# MijnTaal project guide

MijnTaal is a personal Dutch learning application with English as its reference language. This guide explains the reusable source project: where code lives, how requests move through it, and which files you would change for common tasks. It does not describe an exported personal database or a particular hosted installation.

## Start here

Read these files in order:

1. [README](../README.md): features, requirements, local startup and checks.
2. [This guide's request flow](#how-a-request-moves-through-the-project): the relationship between the screen, APIs and storage.
3. [Main screen](../app/page.tsx): how the application brings its features together.
4. [Material service](../lib/server/materials.ts) and [database schema](../db/schema.ts): the core saved data.
5. The component and service for the feature you want to change, using the tables below.
6. [Sites setup](SITES.md) and [MCP setup](MCP.md): installation, deployment and chat integration.

## The overall structure

```text
mijntaal/
├── app/                      Pages, React components, HTTP APIs and MCP endpoint
│   ├── components/           Reusable interface pieces and feature screens
│   ├── api/*/route.ts        Browser-facing server endpoints
│   ├── mcp/route.ts          Chat-facing material tools
│   └── texts/page.tsx        Text-library entry point
├── lib/                      Shared learning, dictionary and audio logic
│   └── server/               Database operations and external provider requests
├── db/                       Drizzle schema declarations and database adapter
├── drizzle/                  Ordered SQL migrations and Drizzle metadata
├── public/                   Assets served directly by the website
│   ├── brand/                Logo and application icon
│   └── dictionary/v1/        Processed dictionary shards and indexes
├── scripts/                  Development, checks, data import and Sites staging
│   └── vite/                 Vendored Sites development/build integration
├── tests/                    Local regression tests with controlled fixtures
├── docs/                     Installation, MCP and project guide
├── .openai/                  Example and local Sites hosting configuration
├── .github/workflows/        GitHub checks, without automatic deployment
└── root configuration files  Dependencies, TypeScript, Vite, lint and formatting
```

The application uses React and Next-style App Router files. Its build/runtime integration is **Vinext on Vite**, targeting a **Cloudflare Worker** through Sites. It is not a collection of static HTML pages: the APIs and MCP endpoint require server execution, a database and account authentication.

[worker/index.ts](../worker/index.ts) exports the Vinext fetch handler. [vite.config.ts](../vite.config.ts) combines Vinext, the Sites integration and the Cloudflare plugin, and declares local `DB` and `BUCKET` bindings. The placeholder database identifier there is a local development value, not the identity of a hosted installation.

## How a request moves through the project

```text
Browser screen                         AI chat
      │                                   │
      ▼                                   ▼
app/api/*/route.ts                  app/mcp/route.ts
      │                                   │
      └───────────────┬───────────────────┘
                      ▼
               lib/server/*
                 │       │
                 ▼       ▼
              D1 data   Provider APIs / R2 audio files
```

The interface also loads bundled dictionary files directly from `public/dictionary/v1/`. Browser-side caches and pending practice events help keep interactions responsive; they are separate from the server's saved records.

For example, saving a phrase from the browser calls `/api/materials`. The route reads the authenticated account, parses the request and calls `addMaterial`. The service validates it, checks for an existing exact entry and writes its material and practice state to D1. Saving through MCP calls the same material service, so the browser and chat use the same collection rules.

### Authentication boundary

[lib/server/common.ts](../lib/server/common.ts) provides `owner`, `mutation`, `body`, `json`, `fail`, `db`, hashing and rate-limit helpers. Routes use the trusted account header supplied by Sites. Browser mutations reject a supplied cross-origin `Origin`; services scope records to the account owner. Expected failures become user-facing `AppError` responses.

[app/chatgpt-auth.ts](../app/chatgpt-auth.ts) contains helpers for reading ChatGPT identity and producing safe sign-in/sign-out URLs. The development Sites Vite plugin supplies a synthetic identity only for its supported loopback flow. Neither file is an independent production OAuth implementation. Moving the app to another host requires replacing or securing this identity boundary.

## Pages and interface components

| File or group                                                                                                                          | Responsibility                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [app/layout.tsx](../app/layout.tsx)                                                                                                    | HTML shell, page metadata, global stylesheet and icon references.                                                                                                                             |
| [app/page.tsx](../app/page.tsx)                                                                                                        | Main client application: Search, Collection, Practice, Settings and Texts navigation; search orchestration, collection editing and provider settings state. This is a large integration file. |
| [app/texts/page.tsx](../app/texts/page.tsx)                                                                                            | Reuses the main app with Texts selected initially; it is not a separate copy of the application.                                                                                              |
| [app/globals.css](../app/globals.css)                                                                                                  | Application styling, layout, responsive behavior and visual states.                                                                                                                           |
| [app/data.ts](../app/data.ts)                                                                                                          | Small illustrative Dutch/English demo text, not the user's saved collection.                                                                                                                  |
| [app-header.tsx](../app/components/app-header.tsx)                                                                                     | Brand, navigation and account controls.                                                                                                                                                       |
| [collection-details.tsx](../app/components/collection-details.tsx)                                                                     | Detail view for saved material.                                                                                                                                                               |
| [backup-controls.tsx](../app/components/backup-controls.tsx)                                                                           | Export, import preview and restoration controls.                                                                                                                                              |
| [practice.tsx](../app/components/practice.tsx)                                                                                         | Switches between Words and Sentences practice.                                                                                                                                                |
| [words-practice.tsx](../app/components/words-practice.tsx), [words-settings.tsx](../app/components/words-settings.tsx)                 | Words session interface and preferences.                                                                                                                                                      |
| [sentences-practice.tsx](../app/components/sentences-practice.tsx), [sentences-settings.tsx](../app/components/sentences-settings.tsx) | Sentence-building/typing interface and session preferences.                                                                                                                                   |
| [texts-reader.tsx](../app/components/texts-reader.tsx)                                                                                 | Text library, reading, translation/preparation and playback interface.                                                                                                                        |
| [speech-settings.tsx](../app/components/speech-settings.tsx)                                                                           | Audio provider connection, voice and audio configuration.                                                                                                                                     |
| [use-word-audio.ts](../app/components/use-word-audio.ts)                                                                               | React hook for word pronunciation loading, caching and playback state.                                                                                                                        |
| [word-forms.tsx](../app/components/word-forms.tsx), [noun-title.tsx](../app/components/noun-title.tsx)                                 | Dictionary forms and noun/article presentation.                                                                                                                                               |
| [learning-progress.tsx](../app/components/learning-progress.tsx), [practice-badge.tsx](../app/components/practice-badge.tsx)           | Learning progress and practice labels.                                                                                                                                                        |
| [answer-mode.tsx](../app/components/answer-mode.tsx), [practice-mode-select.tsx](../app/components/practice-mode-select.tsx)           | Exercise/answer mode selectors.                                                                                                                                                               |
| [reset-progress.tsx](../app/components/reset-progress.tsx), [confirm-text-delete.tsx](../app/components/confirm-text-delete.tsx)       | Confirmation interfaces for reset and text deletion actions.                                                                                                                                  |

The files in `app/components/` concern rendering and interaction. Prefer putting a rule that must also apply to MCP or other clients in the appropriate server service, rather than only in a button handler.

## Browser API routes

Each route lives at `app/api/<name>/route.ts`. These are thin HTTP adapters, with some existing logic still directly inside a route.

| Endpoint and route                                        | Purpose and principal service                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [/api/materials](../app/api/materials/route.ts)           | List/read with `GET`, add with `POST`, update/archive/restore with `PATCH`; uses `server/materials.ts`.                                |
| [/api/lookup](../app/api/lookup/route.ts)                 | Dictionary enrichment, phrase translation and selected word-form translation; uses `server/dictionary.ts` and `server/translation.ts`. |
| [/api/settings](../app/api/settings/route.ts)             | Read settings; verify/save/remove an OpenAI key; save preferences.                                                                     |
| [/api/audio-settings](../app/api/audio-settings/route.ts) | Read/manage ElevenLabs connection, voices and preferences.                                                                             |
| [/api/speech](../app/api/speech/route.ts)                 | Current word/phrase pronunciation entry point; calls `elevenSpeech`.                                                                   |
| [/api/text-library](../app/api/text-library/route.ts)     | Lightweight text listing without loading all text details.                                                                             |
| [/api/texts](../app/api/texts/route.ts)                   | Read/edit texts, translate segments and request prepared audio.                                                                        |
| [/api/words](../app/api/words/route.ts)                   | Words status, session start, answers, batched event synchronization and reset.                                                         |
| [/api/sentences](../app/api/sentences/route.ts)           | Sentence session status, start and batched event synchronization.                                                                      |
| [/api/practice](../app/api/practice/route.ts)             | Existing simpler review queue/rating endpoint using `review_state` and `review_attempts`; not the same implementation as `/api/words`. |
| [/api/status](../app/api/status/route.ts)                 | Existing key/audio-cache status response. Consult the current settings/audio routes when changing provider readiness behavior.         |
| [/api/backup](../app/api/backup/route.ts)                 | Collection export, import preview and confirmed import; uses `server/backup.ts` and a larger bounded request body than ordinary APIs.  |

## Shared logic and server services

Files immediately inside `lib/` mainly describe algorithms, types, browser utilities and reusable transformations. Files in `lib/server/` perform server-side storage and provider work. The similarly named pairs are intentional: one side describes learning rules, the other persists their results.

### Dictionary and collection

- [local-dictionary.ts](../lib/local-dictionary.ts) loads bundled word and suggestion shards in the browser. [dictionary-entry.ts](../lib/dictionary-entry.ts) turns source dictionary rows into application entries.
- [dictionary-snapshot.ts](../lib/dictionary-snapshot.ts) captures dictionary evidence for saved material. [word-forms.ts](../lib/word-forms.ts), [noun-article.ts](../lib/noun-article.ts) and [search-form.ts](../lib/search-form.ts) support forms, noun articles and selected forms.
- [server/dictionary.ts](../lib/server/dictionary.ts) handles server dictionary/enrichment behavior, including upstream dictionary access. [server/translation.ts](../lib/server/translation.ts) builds structured OpenAI translation requests and handles selected forms in context.
- [server/materials.ts](../lib/server/materials.ts) owns validation, duplicate detection, account-scoped reads, optimistic version checking, archive state and practice selection. Browser APIs and MCP share it.
- [client-data.ts](../lib/client-data.ts) provides a browser JSON cache and invalidation helpers. It does not replace the database.

### Words and Sentences practice

- [words.ts](../lib/words.ts) defines Words schemas, preferences, learning dates, intervals, question generation and answer transitions.
- [words-journal.ts](../lib/words-journal.ts) combines a server-confirmed base with pending local events, then reconciles acknowledgements. [server/words.ts](../lib/server/words.ts) validates and persists sessions, attempts and learning state.
- [word-progress.ts](../lib/word-progress.ts) derives progress display values; [server/word-progress.ts](../lib/server/word-progress.ts) attaches saved progress to collection records.
- [sentences.ts](../lib/sentences.ts) defines sentence sessions, event transitions, normalization and local reconciliation. [server/sentences.ts](../lib/server/sentences.ts) selects eligible translated text segments/saved phrases and persists revisions.
- [practice-mode.ts](../lib/practice-mode.ts), [practice-input.ts](../lib/practice-input.ts) and [practice.ts](../lib/practice.ts) contain mode selection, answer/input helpers and the simpler review queue logic.

### Text reading and audio

- [text-segments.ts](../lib/text-segments.ts) splits text into reading segments. [text-audio.ts](../lib/text-audio.ts) groups segments and calculates sentence ranges. [text-preparation.ts](../lib/text-preparation.ts) derives preparation progress.
- [server/texts.ts](../lib/server/texts.ts) reads and edits stored texts, resolves stable segment identities, translates segments and dispatches audio preparation. [server/text-audio.ts](../lib/server/text-audio.ts) prepares ElevenLabs text recordings, timing metadata and sentence clips in R2.
- [server/eleven-speech.ts](../lib/server/eleven-speech.ts) manages ElevenLabs requests and pronunciation caching. The current `/api/speech` route uses this service.
- [server/speech.ts](../lib/server/speech.ts) retains OpenAI speech/realtime and legacy audio helpers. Their presence does not mean the current pronunciation UI uses OpenAI. `server/texts.ts` also retains a legacy preparation path.
- [text-player.ts](../lib/text-player.ts) manages browser playback of prepared text fragments and cues. [audio-sequence.ts](../lib/audio-sequence.ts) manages sequential audio, cancellation and prefetching.
- [persistent-audio.ts](../lib/persistent-audio.ts) caches audio in browser IndexedDB; [pcm.ts](../lib/pcm.ts) handles PCM/WAV conversion; [speech-text.ts](../lib/speech-text.ts) normalizes speech input.

### Settings and backups

[server/settings.ts](../lib/server/settings.ts) defines preferences, encrypts/decrypts provider credentials, reads saved provider configuration and sends OpenAI Responses API requests. Credentials use AES-GCM with an installation-level `CREDENTIAL_ENCRYPTION_KEY` and account-specific associated data. Changing that installation secret can make existing saved credentials unreadable.

[server/backup.ts](../lib/server/backup.ts) defines the collection backup format, validates imports, generates preview/confirmation information and restores compatible records. The legacy `ultimately-dutch-backup` identifier is retained for file compatibility. It is not a separate hosted dependency or an old installation ID.

## Where data lives

| Location                                    | Contents                                                                                                  | Part of public source? |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| Hosted D1, binding `DB`                     | Account-owned materials, preferences, encrypted provider credentials, learning state and service records. | No.                    |
| Hosted R2, binding `BUCKET`                 | Generated audio and related recording/timing files.                                                       | No.                    |
| Browser memory/storage                      | JSON/audio caches and local practice journals.                                                            | No.                    |
| `.wrangler/state/`                          | Local development database and file state, separate from hosted storage.                                  | No; ignored.           |
| `public/dictionary/v1/`                     | Bundled processed dictionary content shared by installations.                                             | Yes.                   |
| Collection backup downloaded through the UI | Materials, translations and supported review/Words state.                                                 | No; keep it private.   |

### Database tables

[db/schema.ts](../db/schema.ts) declares these eight tables. Most current server services use prepared SQL through `db()` in `server/common.ts`; [db/index.ts](../db/index.ts) supplies a Drizzle adapter but is not the common path for those service operations.

| Table             | Meaning                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `materials`       | Kind (`phrase`, `text`, `note`), title, owner, timestamp and JSON body. The body also carries version/archive metadata.                                              |
| `user_settings`   | Encrypted OpenAI credential and preference JSON per owner.                                                                                                           |
| `lookup_cache`    | Mixed service records: lookups, translations, rate counters, Sentence session state and ElevenLabs settings. **Do not clear this entire table as disposable cache.** |
| `review_state`    | Practice enabled state, review rank and last-seen information per material.                                                                                          |
| `review_attempts` | Simpler review attempt history.                                                                                                                                      |
| `words_state`     | Words learning state per material.                                                                                                                                   |
| `words_attempts`  | Words attempt/event records.                                                                                                                                         |
| `words_sessions`  | Saved Words session and revision per owner.                                                                                                                          |

The three SQL files in [drizzle/](../drizzle/) create materials first, then settings/review records, then Words tables. `drizzle/meta/` holds generated schema snapshots and the migration journal. Add a new migration for schema changes; do not rewrite migrations already applied to an installation.

Collection backups do **not** include provider keys/settings, binary audio, browser caches or Sentence session state. Deployment packages and collection backups serve different purposes: deploying code is not a data backup.

## MCP integration

[app/mcp/route.ts](../app/mcp/route.ts) accepts JSON-RPC requests at `/mcp`. It implements discovery/initialization, tool listing and four tool calls: `list_materials`, `get_material`, `add_material` and `update_material`. It delegates to the same material service used by the browser and requires an authenticated owner.

The hosting manifest's `mcp` capability enables Sites integration. Each installation has its own connection; no shared endpoint or credential is part of this project. Sites supplies production authentication and access checks. The route itself is not an OAuth server, and it does not expose provider keys or generate pronunciation. See [MCP.md](MCP.md) for setup and tool usage.

## Configuration files

| File                                                                                                     | What it controls                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [package.json](../package.json)                                                                          | Project metadata, dependencies, pinned package-manager version and runnable commands. `private: true` prevents accidental npm publication; it does not make a GitHub repository private.    |
| [pnpm-lock.yaml](../pnpm-lock.yaml)                                                                      | Exact resolved dependency graph; use frozen-lockfile installs.                                                                                                                              |
| [pnpm-workspace.yaml](../pnpm-workspace.yaml)                                                            | Package age/build policy, shared-store defaults and dependency security overrides. This project does not need a multi-package monorepo to use this file.                                    |
| [.npmrc](../.npmrc)                                                                                      | Package-manager settings.                                                                                                                                                                   |
| [tsconfig.json](../tsconfig.json)                                                                        | Strict TypeScript checking, JSX/module resolution, `@/` alias and generated-file exclusions.                                                                                                |
| [vite.config.ts](../vite.config.ts)                                                                      | Vinext, Sites and Cloudflare integration; local storage bindings and environment-specific preview options.                                                                                  |
| [next.config.ts](../next.config.ts)                                                                      | Present Next-style configuration; currently an empty options object.                                                                                                                        |
| [postcss.config.mjs](../postcss.config.mjs)                                                              | PostCSS/Tailwind processing.                                                                                                                                                                |
| [drizzle.config.ts](../drizzle.config.ts)                                                                | SQLite schema source and migration output directory.                                                                                                                                        |
| [cloudflare-env.d.ts](../cloudflare-env.d.ts)                                                            | Type declarations for optional `DB` and `BUCKET` bindings.                                                                                                                                  |
| [eslint.config.mjs](../eslint.config.mjs)                                                                | Next/TypeScript lint rules, generated-file exclusions and existing warning-level rules. A passing lint command can still report warnings.                                                   |
| [.prettierrc.json](../.prettierrc.json), [.prettierignore](../.prettierignore)                           | Formatting policy and exclusions. Use `pnpm format` to apply it and `pnpm format:check` to check it. Dictionary shards and generated output are excluded.                                   |
| [.editorconfig](../.editorconfig)                                                                        | Shared editor defaults for whitespace, indentation and line endings.                                                                                                                        |
| [.vscode/settings.json](../.vscode/settings.json), [.vscode/extensions.json](../.vscode/extensions.json) | VS Code workspace formatting-on-save settings and the recommended Prettier extension. Install the recommendation to use it.                                                                 |
| [.gitignore](../.gitignore)                                                                              | Excludes local credentials/configuration, generated output, dependencies and private export locations from ordinary Git additions. Ignoring a file does not remove it if already tracked.   |
| [.env.example](../.env.example)                                                                          | Installation secret's variable name, without a secret value. Hosted secrets are configured in Sites settings; local credential testing uses ignored development configuration.              |
| [.openai/hosting.example.json](../.openai/hosting.example.json)                                          | Public template declaring `DB`, `BUCKET` and MCP, without a hosted project identity.                                                                                                        |
| `.openai/hosting.json`                                                                                   | Ignored local installation manifest. Copied from the example on a fresh clone; keeps the target Site ID once provisioned. Required by the Vite config, so create it before local build/dev. |
| [.github/workflows/checks.yml](../.github/workflows/checks.yml)                                          | CI installation, public-source check, formatting, type checking, lint, tests and build. Creates a local manifest from the example. Does not deploy a Site.                                  |

`next-env.d.ts` and `*.tsbuildinfo` can appear locally as generated framework/TypeScript files. Do not treat them as primary application code.

## Scripts and checks

| File or command                                                                                                                             | Purpose                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`, `pnpm build`; [run-framework.mjs](../scripts/run-framework.mjs)                                                                 | Select the portable or managed execution path and start Vinext/build.                                                                                                                           |
| `pnpm start`                                                                                                                                | Runs the already built Worker locally through Wrangler; does not provide the development mock sign-in.                                                                                          |
| `pnpm install:ci`; [install-dependencies.mjs](../scripts/install-dependencies.mjs)                                                          | Runs the pinned pnpm installation helper.                                                                                                                                                       |
| `pnpm db:local`; [local-database.mjs](../scripts/local-database.mjs)                                                                        | Uses the built Wrangler configuration to apply tracked migrations to local D1 only. Build first.                                                                                                |
| `pnpm db:generate`                                                                                                                          | Generates migrations from the Drizzle schema through Drizzle Kit. Review generated SQL before use.                                                                                              |
| `pnpm check:public`; [check-public-release.mjs](../scripts/check-public-release.mjs)                                                        | Checks the public template for installation identities, common credential patterns, personal paths, private configuration and authored Cyrillic text. A safeguard, not a complete secret audit. |
| `pnpm test`; [run-tests.mjs](../scripts/run-tests.mjs)                                                                                      | Runs the `.cjs` regression test files in order with a per-file timeout.                                                                                                                         |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`                                                                                          | TypeScript, ESLint and Prettier checks.                                                                                                                                                         |
| `pnpm sites:stage`; [stage-sites.mjs](../scripts/stage-sites.mjs)                                                                           | Creates or updates deployment staging source; described below.                                                                                                                                  |
| [execution-profile.mjs](../scripts/execution-profile.mjs)                                                                                   | Reads the ignored execution-profile selection; defaults to portable when absent.                                                                                                                |
| [tool-environment.mjs](../scripts/tool-environment.mjs), [sites-env.mjs](../scripts/sites-env.mjs), [sites-env.sh](../scripts/sites-env.sh) | Establish checkout-local tool state and environment defaults for Node/shell commands.                                                                                                           |
| [build-verified.sh](../scripts/build-verified.sh)                                                                                           | Bounded managed-environment build wrapper.                                                                                                                                                      |
| [scripts/vite/sites-vite-plugin.ts](../scripts/vite/sites-vite-plugin.ts)                                                                   | Vendored integration for loopback development identity and copying hosting configuration/migrations into build output. Preserve its adjacent license.                                           |
| [import-dictionary.py](../scripts/import-dictionary.py)                                                                                     | Rebuilds dictionary shards and suggestion indexes from a supplied upstream JSONL dump. The raw dump is not bundled.                                                                             |

Tests cover core material/practice behavior, daily Words rules/UI, navigation and collection controls, dictionary/forms, browser data caching, audio sequencing/stream handling, text playback and deployment staging. Many tests load modules into controlled VM harnesses with mock providers and storage. They are not proof that a real provider account, hosted authentication or another AI client's MCP connection works.

## Public source, deployment source and running Site

The public repository contains reusable application code. Your ignored local `hosting.json` connects your working folder to one installation. The installed Sites plugin has its own deployment helper and source repository; those helpers are external tools, not bundled application files.

The staging code exists because the current Sites helper expects the installation manifest in its deployment Git snapshot, while this public repository excludes it. This is the chosen workflow for this template, not a requirement to maintain two separately edited applications.

1. Edit and check this public project.
2. Configure the intended Site ID locally; `sites:stage` stops if it is missing or invalid.
3. `pnpm sites:stage` copies source into a new temporary directory, including current untracked/non-ignored source and the local manifest, while excluding dependencies, Git metadata, builds, data and secrets.
4. For an existing Site, the assistant first uses the authenticated Sites helper to open its source in an empty temporary checkout. Running `pnpm sites:stage --checkout <opened-checkout>` from this public folder then replaces that clean checkout's source, preserves its Git history and removes tracked files deleted from the public source. The Site ID must match.
5. The authenticated Sites workflow installs/builds/packages, saves source/version and deploys the selected version. `sites:stage` itself does none of those hosted operations.

The staged `.gitignore` allows its installation manifest into the private deployment snapshot. The public `.gitignore` remains unchanged. Run the public-source check in the public folder, not in that private snapshot. See [SITES.md](SITES.md) for the exact assistant workflow.

There is no automatic two-way synchronization between a deployed Site and this local folder. A GitHub push also does not trigger a deployment in this project. Prefer changing this local source first; if an independent Sites conversation changes hosted source, bring those edits back here before the next local-source deployment to avoid overwriting them.

## Documentation, assets and generated files

- [README.md](../README.md) is the entry point; [CONTRIBUTING.md](../CONTRIBUTING.md) explains change and dependency conventions; [SECURITY.md](../SECURITY.md) covers security reporting/handling.
- [SITES.md](SITES.md) covers installation, storage, secrets, local development and deployment. [MCP.md](MCP.md) explains the chat tools. This guide supplies the source map.
- [LICENSE](../LICENSE) licenses application code under MIT. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) preserves dictionary, vendored integration and dependency attribution. Dictionary licensing is separate from application MIT licensing.
- [public/brand/](../public/brand/) contains the logo and icon referenced by the app/header. [public/dictionary/v1/manifest.json](../public/dictionary/v1/manifest.json) records dictionary source metadata; hashed word shards and `index-*.json` files are generated data, not handwritten logic.
- `node_modules/`, `dist/`, `.next/`, `.vinext/`, `.wrangler/` and `.sites-runtime/` are dependencies, builds or checkout-local state. They may be large; start reading authored source instead.
- Export archives and private recovery material outside this public project are not part of its runtime or intended GitHub contents.

## Where to make a change

| Desired change                            | Start with                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Name, icon or page title                  | `public/brand/`, `app/components/app-header.tsx`, `app/layout.tsx`.                                  |
| Colors, spacing or responsive layout      | `app/globals.css` and the relevant component.                                                        |
| Search results or dictionary form display | `app/page.tsx`, dictionary/form helpers and `app/components/word-forms.tsx`.                         |
| Collection validation or archive behavior | `lib/server/materials.ts`; check browser and MCP behavior together.                                  |
| Words scheduling, scoring or sync         | `lib/words.ts`, `lib/words-journal.ts`, `lib/server/words.ts`, Words tests and component.            |
| Sentence exercises                        | `lib/sentences.ts`, `lib/server/sentences.ts`, Sentences component.                                  |
| Text editing/translation/playback         | Text reader, `lib/server/texts.ts`, text segmentation/player/audio modules.                          |
| Provider settings or encrypted keys       | Settings routes/components and `lib/server/settings.ts`.                                             |
| Chat tools                                | `app/mcp/route.ts`, shared material service and `docs/MCP.md`.                                       |
| Database structure                        | `db/schema.ts`, a new `drizzle/` migration and affected server queries.                              |
| Deployment behavior                       | `scripts/stage-sites.mjs`, `docs/SITES.md`, local hosting configuration and installed Sites tooling. |

Reading this guide or passing local checks does not establish that any particular hosted installation or paid provider connection has been verified.
