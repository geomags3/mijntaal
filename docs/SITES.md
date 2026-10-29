# Deploy your own MijnTaal with ChatGPT Sites

## Prepare

Start from a fresh clone with no personal data. The tracked `.openai/hosting.example.json` declares `DB`, `BUCKET` and the `mcp` capability, without a `project_id`. Create your ignored local configuration:

```sh
cp .openai/hosting.example.json .openai/hosting.json
```

Run this once on a fresh clone; do not overwrite an existing installation configuration. Sites reads `hosting.json`; it does not merge the example with the local file. Keep your installation's `project_id` in the local file only.

Ask Codex or ChatGPT with Sites available:

> Deploy this local MijnTaal project as a new private ChatGPT Site. Preserve its source and Sites integration. Provision its database and file storage, apply the existing migrations, and enable its MCP tools. Do not reuse another site's identity or data.

The Sites workflow must create a new project, save its returned identity locally, synchronize source, build and deploy it. Do not overwrite a provisioned ID to update an existing instance. The public template must never receive that local deployment identity; the public-release check rejects it in public source and rejects a Git-tracked local hosting file.

The standard Sites source helper requires the complete hosting manifest in its committed deployment snapshot. When deploying this public template, use a separate staging checkout containing the local manifest. Do not commit that manifest to the public GitHub repository. Use the staging command below to prepare that checkout automatically.

## Deploy changes from one working folder

Keep editing this public source folder. Once your ignored `hosting.json` contains the intended Site ID, run:

```sh
pnpm sites:stage
```

The command checks the public source and creates a new temporary staging folder. It prints that folder's path and the target Site ID. It includes current source edits (including untracked, non-ignored files) and your local hosting configuration. It excludes Git history, dependencies, builds, backups, local data and environment files. It preserves the application's backup API. Review and run the normal project checks before deploying.

This command only prepares files. It does not create a Site, authenticate, build, push source or publish. To finish, ask Codex or ChatGPT with the Sites plugin:

> Deploy the current MijnTaal source to the existing Site identified by my local hosting.json. Use the staging workflow in docs/SITES.md. Preserve the Site's audience, database, files and runtime secrets.

The assistant handles the authenticated steps below; you do not maintain a second working folder. Temporary staging directories contain installation configuration; keep them out of the public repository. Delete them after successful deployment, or retain them to investigate a failed deployment.

### Authenticated deployment workflow

1. Read the local Site ID and use Sites `get_site` to confirm the target and audience. Obtain a fresh source-repository credential through Sites; keep it in memory and pass it through stdin only.
2. Open the existing Site with the Sites source helper in an **empty temporary directory**. Do not open it in this public repository or in the populated snapshot from `sites:stage`: an existing remote needs an empty checkout. Retain the helper's complete opening result.
3. Populate the returned clean checkout from this public working folder:

   ```sh
   pnpm sites:stage --checkout /absolute/path/returned/by/sites
   ```

   This validates the matching Site ID, preserves deployment Git history, replaces tracked source with the current public source, and removes tracked files deleted from the public project. It rejects a dirty checkout or a different Site. It includes the local hosting file in the deployment repository only. Run this command from the public project, not the temporary checkout.

4. In that deployment checkout, use the Sites source helper with the opening result, dependency installation, appropriate checks, the official Sites build helper and an archive destination outside the checkout. Run `check:public` in the public source **before** staging, not in the private snapshot: the latter intentionally tracks the installation manifest. Pass credentials only through stdin. Do not use a public GitHub remote as the deployment source repository.
5. Save and deploy the returned commit and archive through Sites, preserving the existing audience. Confirm the deployment result before deleting temporary files. A GitHub push alone does not deploy a Site.

The public source repository and Sites source repository have separate commit histories. No credentials are saved by the staging command; production secrets remain configured in Sites. No hosted operation has been tested merely by running this command locally.

## Configure secrets

Create a fresh `CREDENTIAL_ENCRYPTION_KEY` for the new installation: 32 cryptographically random bytes encoded as 64 lowercase hexadecimal characters. Configure it through Sites runtime secrets. Do not put it in the hosting manifest, repository, screenshots or chat. Once credentials have been stored, changing this key makes them unreadable; re-enter provider keys or perform a deliberate migration.

Open the app's Settings to connect Azure Translator with your subscription key and resource region for fast phrase/text translations. Connect your own OpenAI account for fallback translation and grammar/explanations. Keys previously stored as `MICROSOFT_AZURE_SUBSCRIPTION_KEY` and `MICROSOFT_AZURE_SUBSCRIPTION_REGION` in another project must be entered securely in this app's Settings; they are not read from deployment-wide environment variables. Connect your own ElevenLabs key, refresh My Voices, and choose a voice/model. Text and audio are independent. Test provider functions deliberately; these requests can incur charges. None of these secrets is bundled in the project.

## Verify a new installation

1. Confirm the new Site is private and uses its own project identity.
2. Sign in and check the empty collection and dictionary.
3. Add, edit, archive and restore a small test entry.
4. Check Words and Sentences practice, then export and preview a backup.
5. Connect the generated personal MCP plugin and list/read the test entry.
6. Test provider features only after configuring your own credentials.

Your original personal collection is not part of the public starter. Import it manually if desired; avoid restoring another site's low-level database because account IDs are scoped to each Site.

## Local development

Use Node.js 24 and pnpm 11.25.0. `pnpm install --frozen-lockfile` installs dependencies. `pnpm build` emits `dist/server/wrangler.json`. On a fresh local store, `pnpm db:local` applies the tracked migrations in order and records which have been applied. Run it again after adding migrations, including the lesson tables. It never uses `--remote`.

`pnpm dev -- --hostname 127.0.0.1` runs the portable development server. Loopback development provides a test sign-in identity; it is not production authentication. `pnpm start` runs the built Worker locally and does not simulate sign-in. `.wrangler/state` contains local data; never commit it.

For local credential testing, put only the encryption secret in an ignored `.dev.vars` file, using the variable name from `.env.example`. Configure provider keys through the UI. A local chat can use a compatible local MCP connection; an ordinary hosted chat cannot reach localhost automatically.

## Scope

The supported deployment target is Sites, running a Cloudflare Worker with D1 and R2. A static file host cannot run the API or MCP server. Hosting elsewhere requires adapting storage and authentication; do not trust client-supplied identity headers on an unprotected public server.

References: [managing a Site](https://learn.chatgpt.com/docs/sites/managing-a-site) and [Sites-hosted MCP](https://learn.chatgpt.com/docs/extend/mcp).
