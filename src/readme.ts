export interface RenderReadmeInput {
	project_id: string;
	store_description?: string;
}

export function renderReadmeContent(input: RenderReadmeInput): string {
	if (!input.project_id) {
		throw new Error("project_id must be a non-empty string");
	}

	const storeDescription = input.store_description?.trim();
	const storeDescriptionSection = storeDescription
		? `\n## Store description\n\n${storeDescription}\n`
		: "";

	return `# kaged agent memory

This directory holds agent-learned context for the project \`${input.project_id}\`.

Files in this directory are written by \`@kaged/memory-markdown\` as agents call
the \`memory-markdown.retain\` tool and as the daemon fires session-lifecycle
hooks. Each file is plain markdown with YAML frontmatter.
${storeDescriptionSection}

## Storage convention

- \`agent/\` — the primary agent's memory (under \`isolation: agent\`).
- \`subagent/<name>/\` — a direct subagent's memory.
- \`subagent/<parent>.<child>/\` — a nested subagent's memory.
- \`project/\` — shared memory across all agents (under \`isolation: project\`).

Each subdirectory contains:
- Per-event memory files named \`<id>.md\` where \`<id>\` is a 16-character hex
  snowflake (sortable by creation time).
- A \`facts.md\` accumulator for short retains (operator-curated).
- A \`transcripts/\` subdirectory with one file per kaged session.

## Should I commit this?

That's your call. Reasonable defaults:

- **Per-operator workflow**: gitignore everything. Memory is operator-local.
- **Team workflow**: commit, treat memory as project context, review changes.
- **Mixed**: commit \`facts.md\` (curated), gitignore the rest (transient).

Add \`**/transcripts/\` and add a glob for hex-id files (e.g. \`**/[0-9a-f][0-9a-f][0-9a-f][0-9a-f]*.md\`)
to \`.gitignore\` if you want only the curated \`facts.md\` files committed.

## What's safe to hand-edit?

- \`facts.md\` files — these are operator-curated; agents read and append.
- Individual memory files — yes, but the agent that wrote one may have linked to it.

## What's not safe?

- Anything inside \`transcripts/\` — the daemon may overwrite (full-session mode)
  or chunk-rotate. Hand-edits there will be lost.
`;
}
