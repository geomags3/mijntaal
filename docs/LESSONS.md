# Programs and lessons

Lessons provide a guided Dutch learning path alongside Collection, Texts and Practice.
ChatGPT authors content through MCP; MijnTaal validates, stores and renders it, checks
answers immediately and saves progress. Taking a lesson requires no provider API call.
Dutch remains the target language and English the translation reference. Explanations
can use the learner's requested language.

An empty library offers **Explore a sample lesson**, like the sample reader in Texts.
It immediately opens the first step of the bundled getting-around-town example,
including all six exercise formats, hints, feedback and mistake practice. This is an
unsaved preview: answers stay in the current page's memory, no account records are
created, and leaving the sample or reloading starts it fresh. It cannot delete an
owned lesson and does not expose account run history. Collection and practice progress
remain unchanged. The chat example uses `@MijnTaal` to identify the Site in ChatGPT.

## Organization

A program contains ordered topics. Lessons can belong to a program and one of its
topics, or stand alone. Each has a title, description, optional CEFR level, estimated
minutes and an explicit order. Program and lesson content have optimistic versions.
Archiving hides content from the active library without deleting progress. Topics
referenced by lessons cannot be removed or renamed by changing their IDs.

## Lesson flow

Aim for 5–15 minutes: a concrete goal, a short explanation, examples, exercises,
another explanation when needed, and a summary. Alternate learning and retrieval;
avoid a long article followed by an unrelated test. One block appears at a time,
with visible progress and an explicit Continue button. Leaving and returning resumes
the saved block, including feedback. All controls work by keyboard and touch.

Supported content blocks:

- `explanation`: compact Markdown, optional heading. Supports paragraphs, lists and emphasis.
- `table`: two or three columns, up to eight rows, optional caption.
- `diagram`: a short ordered sequence of labeled steps, rendered vertically.
- `image`: an HTTPS image URL with required alternative text and optional caption.
  Images must be appropriate to share through that URL; image binaries are not uploaded
  by the lesson tools. No HTML, embedded scripts, arbitrary SVG or diagram code is run.

Supported exercises:

- `flashcard`: reveal the answer, then self-assess Recalled / Not yet. This is explicitly
  self-assessment, not an automatically graded answer.
- `choice`: exactly four distinct options and one correct option index.
- `letters`: arrange supplied character blocks, including repeated letters and spaces.
- `words`: arrange supplied word blocks, including repeated words.
- `match`: pair two to six items by tapping left and right entries, without dragging.
- `gap`: a sentence containing exactly one `___`; type an answer or choose an option.

Every exercise includes feedback explaining the expected answer, and may include a
hint. Typed and assembled answers accept explicit alternatives, normalize Unicode,
case, whitespace and surrounding sentence punctuation, but retain accents, spelling,
articles and word order. Authored block sets must reconstruct the primary answer.
Correct alternative translations must be supplied by the author; there is no live AI
grader. Choice and matching exercises use indices so duplicate visible blocks retain
their identity. Hints count as help. Revealing a flashcard is part of self-assessment;
it never counts as an independently graded answer.

### Text formatting

Lesson JSON stays unchanged in structure; formatting lives inside descriptive strings.
Explanations (`text` and exercise `explanation`) support paragraphs separated by blank
lines, `**bold**`, `*italic*`, backtick-wrapped inline code, flat bullet/numbered lists,
`#`–`####` subheadings (rendered compactly as h3) and `>` quotes. Prompts, hints,
headings, captions, table cells and diagram labels support inline emphasis and code.
Use code styling to highlight a Dutch form, for example ``Start with `ik`.``.
Backslashes can escape backticks, asterisks and backslashes. Single line breaks in
explanation paragraphs are preserved for bilingual examples.

This is a limited Markdown renderer, not arbitrary HTML or full CommonMark. Links,
Markdown images, embeds and HTML remain literal text; use the structured `image`
block for pictures and `table` for tables. Graded `answer`, `answers`, `options`,
`tokens`, matching pair labels and gap `sentence` remain plain text. Never put
formatting markers in those fields: they are part of the actual language being checked.
Presentation changes do not rewrite an existing lesson run or its results.

## Progress and edits

Progress is account-scoped, checked on the server and written with an optimistic
revision. Each action has an ID: retrying an action after a lost response does not
apply it twice. A pending request is retried with the same ID and revision. A conflict
requires explicitly reloading saved progress; it never silently overwrites another tab.
This first version requires a connection to save actions. Failed answers remain on
screen for retry while the page stays open; there is no offline journal or offline
completion guarantee. Only acknowledged actions are safe to resume on another device.

A run captures the lesson version and content at its start. Later edits do not alter
that run or its completed results. The learner can finish that version, then explicitly
start the latest version. **Start over** is available inside an unfinished lesson;
library cards stay focused on opening or continuing a lesson. Confirmation starts step 1 of the latest version;
Cancel / Keep learning and Escape leave progress untouched. The unfinished run, including
checked answers and feedback, is atomically saved to Previous runs before it is replaced.
History labels it **Restarted**, separately from **Completed** runs. A lost response can
be retried with the same action ID without saving the old run or restarting twice.
Concurrent progress changes require reloading and confirming again. Completed runs
are retained in history when a new run begins. Mistakes can be reviewed and practised
in a separate retry run. Finishing a lesson does not imply long-term mastery and does
not change Words or Sentences scheduling. Content is not automatically added to the
collection. Lesson data is currently separate from collection backups.

### Permanently deleting a lesson

Open a lesson and choose **Delete lesson**. This works before starting as well as
during or after a run. The confirmation names the lesson and warns that **Delete
permanently** removes the lesson, its progress and every saved run, without moving
anything to Archive. **Keep lesson** and Escape cancel without changing data.
Programs, topics, other lessons and collection materials remain unchanged.

Browser `DELETE /api/lessons` and MCP `delete_lesson` share the same owner-scoped
service and require `{id, version, revision, confirm: true}` from a fresh lesson read.
Deletion is atomic and checks both the authoring version and progress revision;
concurrent edits or answers require reloading and confirming again. Retrying an
already successful deletion is a no-op. No deleted content or tombstone is retained.
In the browser, an uncertain response keeps other lesson actions disabled until
Retry deletion or an explicit conflict reload resolves it. Older library responses
cannot put a deleted card back on screen.

## MCP authoring contract

- `list_programs`, `get_program`, `save_program` organize curricula and topics.
- `list_lessons`, `get_lesson`, `save_lesson` author and maintain lesson content.
- `delete_lesson` permanently removes an explicitly selected lesson after user approval;
  read the lesson first and pass its version and progress revision with `confirm: true`.
- Omit `id` and `version` to create. To update, read first and provide both the current
  `id` and `version`, plus the complete content. Updates return the new version.
- Keep IDs of unchanged topics and blocks stable. Generate a whole program outline
  first, then save lessons individually to stay within request size limits.
- Schemas exposed by `tools/list` specify all fields, bounds and block formats.
- Read tools include saved progress summaries so ChatGPT can suggest a next lesson;
  MCP authoring tools never submit answers or mark a lesson complete.
- Validation rejects ambiguous or incomplete exercises, duplicate block/topic IDs,
  unsafe image URLs, mismatched program/topic ownership and stale versions.

Suggested chat request: “Create an A1 program about everyday Dutch with three topics.
Save its outline, then add a ten-minute lesson on inversion with a short explanation,
examples, word blocks, multiple choice and gap exercises.”

Complete example payloads are available for [getting around town](examples/lesson-a1-city.json)
and [dit, deze, die, dat](examples/lesson-a1-demonstratives.json). The demonstratives lesson
uses original examples and the grammatical distinctions described by
[Taaladvies.net](https://taaladvies.net/dit-of-dat-deze-of-die-algemeen/), with explicit
near/far contexts to make each exercise answer unambiguous.

## Further development

Optional collection saving, richer accessible diagrams, managed image uploads,
program-level recommendations, lesson backup export/import and durable offline
journals can extend this format. They must preserve existing learning state and
clearly distinguish completion, self-assessment and independent correct answers.
