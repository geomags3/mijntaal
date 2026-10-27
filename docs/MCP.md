# Connect MijnTaal to your AI chat

MijnTaal serves a stateless JSON-RPC endpoint at `/mcp`. The `mcp` capability in the hosting manifest enables Sites integration. Each installation has its own endpoint and personal plugin.

When the owner publishes the Site, Sites provisions its personal plugin. Open the returned plugin card or Plugins → Personal → Created by you, then Install and Connect as needed. Start a new chat and select the plugin. Use the endpoint and connection details returned for your new Site; there is no shared endpoint or embedded token in this repository.

## Tools

| Tool              | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `list_materials`  | Search active entries; request archived entries explicitly.               |
| `get_material`    | Read one entry and its current version.                                   |
| `add_material`    | Save a phrase, note or Dutch text.                                        |
| `update_material` | Edit, archive, restore or change practice mode using the current version. |

Phrase bodies can include `en`, `example`, `exampleTranslation`, `notes`, `original` and `source`. Text bodies include `source` and `segments: [{nl, en}]`. Use `practiceMode: words`, `sentences` or `off` for phrases; practice requires an English meaning.

Example requests in your chat:

- “Save this Dutch phrase with its English meaning to MijnTaal.”
- “Add this text and preserve the original wording.”
- “Find my saved phrases about work.”

Before editing, read the entry and use its returned version. A conflict requires reloading; do not overwrite a newer edit. MCP is scoped to the authenticated caller's collection. It does not expose provider keys or generate audio.

Sites owns authentication, checks Site access, and injects the trusted account identity. The route's identity-header check is not an independent OAuth server. Other AI clients need compatible MCP transport and authentication; support must be tested per client rather than inferred from the protocol alone.
