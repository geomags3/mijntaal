# Contributing

MijnTaal currently focuses on Dutch with English translations. Keep changes within that scope and preserve account isolation, original text, backup compatibility and existing learning progress.

Use Node.js 24 and the pinned pnpm version. Run the checks listed in README before proposing a change. Format authored source with `pnpm format`; dictionary shards and generated lockfiles are excluded. Never edit a saved migration in place: append a new migration for schema changes.

## Formatting

Open the `mijntaal/` folder as your editor workspace. In VS Code, install the recommended Prettier extension (`esbenp.prettier-vscode`); the committed workspace settings enable formatting on save using `.prettierrc.json`. Other editors can use their Prettier integration with the same configuration. `.editorconfig` defines shared whitespace defaults.

Run `pnpm format` to format authored files, or `pnpm format:check` to check them without writing. CI runs the same check. Builds, dependencies, dictionary shards, lockfiles and local hosting configuration are excluded. Long strings such as provider prompts and SQL may exceed the preferred line width because Prettier does not split string contents.

## Tests and changes

Tests run without external provider credentials. Add a focused regression test for behavior changes involving data, synchronization or authorization. Do not add tests that merely repeat implementation details.

Keep provider keys, local state, personal backups, generated deployment IDs and private recordings out of commits. Use synthetic fixtures in tests. Code comments should explain constraints or non-obvious behavior; keep private investigation notes outside the repository.

Dependency changes must preserve the frozen-lockfile install. The workspace normally waits seven days before installing newly published packages. Any exception must name an exact reviewed security patch and explain why it is needed; do not disable the policy globally.
