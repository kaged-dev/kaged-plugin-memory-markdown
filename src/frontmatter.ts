import { YAML } from "bun";

export type MemoryKind = "retain" | "transcript" | "injection-source";

export interface MemoryEntry {
	id: string;
	created_at: string;
	agent_path: string;
	session_id: string;
	operator_id: string;
	tags?: string[];
	context?: string;
	kind: MemoryKind;
	body: string;
}

const VALID_KINDS: ReadonlySet<MemoryKind> = new Set(["retain", "transcript", "injection-source"]);

const REQUIRED_SCALAR_FIELDS = [
	"id",
	"created_at",
	"agent_path",
	"session_id",
	"operator_id",
	"kind",
] as const;

export function buildEntryFile(entry: MemoryEntry): string {
	const frontmatter: Record<string, unknown> = {
		id: entry.id,
		created_at: entry.created_at,
		agent_path: entry.agent_path,
		session_id: entry.session_id,
		operator_id: entry.operator_id,
	};
	if (entry.tags && entry.tags.length > 0) {
		frontmatter.tags = entry.tags;
	}
	if (entry.context) {
		frontmatter.context = entry.context;
	}
	frontmatter.kind = entry.kind;

	const yaml = YAML.stringify(frontmatter).trimEnd();
	const body = entry.body.endsWith("\n") ? entry.body : `${entry.body}\n`;
	return `---\n${yaml}\n---\n${body}`;
}

export function parseEntryFile(content: string): MemoryEntry {
	const { yamlText, body } = splitDelimiters(content);

	let frontmatter: Record<string, unknown>;
	try {
		const parsed = YAML.parse(yamlText);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("YAML frontmatter must be a mapping");
		}
		frontmatter = parsed as Record<string, unknown>;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Malformed YAML frontmatter: ${message}`, { cause: err });
	}

	for (const field of REQUIRED_SCALAR_FIELDS) {
		const value = frontmatter[field];
		if (typeof value !== "string" || value.length === 0) {
			throw new Error(`Entry frontmatter missing required string field: "${field}"`);
		}
	}

	const kind = frontmatter.kind as string;
	if (!VALID_KINDS.has(kind as MemoryKind)) {
		throw new Error(
			`Entry frontmatter has invalid "kind": "${kind}". ` +
				`Valid kinds: ${[...VALID_KINDS].join(", ")}`,
		);
	}

	const tags = frontmatter.tags;
	if (tags !== undefined && !isStringArray(tags)) {
		throw new Error('Entry frontmatter "tags" must be an array of strings');
	}

	const context = frontmatter.context;
	if (context !== undefined && typeof context !== "string") {
		throw new Error('Entry frontmatter "context" must be a string');
	}

	const entry: MemoryEntry = {
		id: frontmatter.id as string,
		created_at: frontmatter.created_at as string,
		agent_path: frontmatter.agent_path as string,
		session_id: frontmatter.session_id as string,
		operator_id: frontmatter.operator_id as string,
		kind: kind as MemoryKind,
		body,
	};
	if (tags && tags.length > 0) entry.tags = tags;
	if (context) entry.context = context;
	return entry;
}

interface SplitResult {
	yamlText: string;
	body: string;
}

function splitDelimiters(content: string): SplitResult {
	const normalized = content.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---\n")) {
		throw new Error("Entry file must start with '---' YAML frontmatter delimiter");
	}

	const afterFirst = normalized.slice(4);
	const closerIndex = afterFirst.indexOf("\n---\n");
	if (closerIndex === -1) {
		if (afterFirst.endsWith("\n---")) {
			return { yamlText: afterFirst.slice(0, -4), body: "" };
		}
		throw new Error("Entry file is missing closing '---' YAML frontmatter delimiter");
	}

	const yamlText = afterFirst.slice(0, closerIndex);
	const body = afterFirst.slice(closerIndex + 5);
	return { yamlText, body };
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}
