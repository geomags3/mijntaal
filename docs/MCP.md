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
| `list_programs`   | List learning programs and their ordered topics.                          |
| `get_program`     | Read a program and its authoring version.                                 |
| `save_program`    | Create or replace a program using optimistic versions.                    |
| `list_lessons`    | List lesson summaries and progress, optionally filtered by program.       |
| `get_lesson`      | Read complete lesson content and the saved run.                           |
| `save_lesson`     | Create or replace a validated lesson without changing existing runs.      |

Phrase bodies can include `en`, `example`, `exampleTranslation`, `notes`, `original` and `source`. Text bodies include `source` and `segments: [{nl, en}]`. Use `practiceMode: words`, `sentences` or `off` for phrases; practice requires an English meaning.

Example requests in your chat:

- “Save this Dutch phrase with its English meaning to MijnTaal.”
- “Add this text and preserve the original wording.”
- “Find my saved phrases about work.”

Before editing, read the entry and use its returned version. A conflict requires reloading; do not overwrite a newer edit. MCP is scoped to the authenticated caller's collection. It does not expose provider keys or generate audio.

## Programs and lessons

Use `save_program` with `content: {title, description, level?, topics: [{id, title,
description?}]}`. Topic array order defines the curriculum order. Create the outline
first, then call `save_lesson` separately for each lesson. Lessons accept `programId`
and `topicId` (both nullable), `order`, and `content: {title, description, goal, minutes,
level?, blocks}`. Omit `id` and `version` to create. Include both, the complete content,
associations and desired `archived` state to update. Do not regenerate stable block IDs.
Missing optional associations default to standalone, so preserve them on updates.

`tools/list` exposes the complete block schemas. Available blocks are `explanation`,
`table`, `diagram`, `image`, `flashcard`, `choice`, `letters`, `words`, `match` and `gap`.
All exercise blocks require `prompt` and `explanation`; `hint` is optional. See
the lesson guide's text formatting rules: descriptive prose accepts compact Markdown,
including `**bold**`, `*italic*` and inline code, while graded answers/options/tokens
and gap sentences remain plain text. Explanation text also supports paragraphs,
flat lists, compact headings and quotes. HTML and links are never executed. See
[Programs and lessons](LESSONS.md) for constraints, compact mobile layouts, accepted
answers and versioned progress. These tools author content; they cannot submit answers
or fabricate completion. Read responses may include saved progress for planning.

Example: “Create an A1 program about everyday Dutch, save its topics, then add a short
lesson on word order with explanations, matching and gap exercises.”

Sites owns authentication, checks Site access, and injects the trusted account identity. The route's identity-header check is not an independent OAuth server. Other AI clients need compatible MCP transport and authentication; support must be tested per client rather than inferred from the protocol alone.
