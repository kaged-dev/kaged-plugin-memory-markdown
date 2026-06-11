import { DEFAULT_CONFIG } from "./config.ts";
import { buildEntryFile, type MemoryEntry, parseEntryFile } from "./frontmatter.ts";
import { generateMemoryId } from "./id.ts";
import { renderReadmeContent } from "./readme.ts";
import { scoreRecall } from "./score.ts";

// -- Constants ---

const SKIP_FILENAMES: ReadonlySet<string> = new Set(["facts.md", "README.md"]);

// -- Error types ---

export class ContentTooLargeError extends Error {
	readonly code = "content_too_large" as const;
	readonly actualBytes: number;
	readonly maxBytes: number;

	constructor(actualBytes: number, maxBytes: number) {
		super(`Content too large: ${actualBytes} bytes exceeds maximum ${maxBytes} bytes`);
		this.name = "ContentTooLargeError";
		this.actualBytes = actualBytes;
		this.maxBytes = maxBytes;
	}
}

// -- Input/output types ---

export interface WriteEntryInput {
	directory: string;
	content: string;
	context?: string;
	tags?: readonly string[];
	max_content_bytes?: number;
	fact_max_length?: number;
	agent_path: string;
	session_id: string;
	operator_id: string;
}

export interface WriteEntryResult {
	status: "stored";
	id: string;
}

export interface RecallInput {
	directory: string;
	query: string;
	tags?: readonly string[];
	max_results?: number;
	now?: number;
	score_recency_24h?: number;
	score_recency_7d?: number;
	score_tag_exact?: number;
}

export interface RecallResultEntry {
	id: string;
	created_at: string;
	agent_path: string;
	tags: string[];
	context: string | null;
	content: string;
	score: number;
}

export interface RecallResult {
	count: number;
	results: RecallResultEntry[];
	query: string;
}

export interface WriteTranscriptInput {
	directory: string;
	session_id: string;
	agent_path: string;
	operator_id: string;
	body: string;
	tags?: readonly string[];
	context?: string;
	/** When provided, produces a compact-chunk filename: `<session>-compact-<id>.md`. */
	compactId?: string;
}

export interface EnsureStoreReadyInput {
	storeRoot: string;
	project_id: string;
	store_description?: string;
}

export interface ForgetResult {
	status: "forgotten" | "not_found";
	id: string;
}

export interface ListTagsResult {
	tags: string[];
	count: number;
}

// -- Public API ---

/**
 * Write a new memory entry to disk.
 *
 * Generates a snowflake ID, writes `<dir>/<id>.md`, and optionally appends
 * to `facts.md` if the content is a short discrete fact.
 */
export async function writeEntry(input: WriteEntryInput): Promise<WriteEntryResult> {
	const maxContentBytes = input.max_content_bytes ?? DEFAULT_CONFIG.max_content_bytes;
	const contentBytes = new TextEncoder().encode(input.content).byteLength;
	if (contentBytes > maxContentBytes) {
		throw new ContentTooLargeError(contentBytes, maxContentBytes);
	}

	await ensureDirectory(input.directory);

	const id = generateMemoryId();
	const now = new Date().toISOString();

	const entry: MemoryEntry = {
		id,
		created_at: now,
		agent_path: input.agent_path,
		session_id: input.session_id,
		operator_id: input.operator_id,
		kind: "retain",
		body: input.content,
	};
	if (input.tags && input.tags.length > 0) entry.tags = [...input.tags];
	if (input.context) entry.context = input.context;

	await Bun.write(`${input.directory}/${id}.md`, buildEntryFile(entry));

	if (isDiscreteFact(input.content, input.fact_max_length ?? DEFAULT_CONFIG.fact_max_length)) {
		await appendToFacts(input.directory, input.content);
	}

	return { status: "stored", id };
}

/**
 * Read all memory entry files from a directory (non-recursive).
 *
 * Skips `facts.md`, `README.md`, and any file that fails to parse.
 * Returns an empty array if the directory does not exist.
 */
export async function readEntries(directory: string): Promise<MemoryEntry[]> {
	const entries: MemoryEntry[] = [];
	const glob = new Bun.Glob("*.md");

	try {
		for await (const filename of glob.scan({
			cwd: directory,
			onlyFiles: true,
		})) {
			if (SKIP_FILENAMES.has(filename)) continue;
			try {
				const content = await Bun.file(`${directory}/${filename}`).text();
				entries.push(parseEntryFile(content));
			} catch {
				// Skip corrupt files per spec § Failure modes
			}
		}
	} catch {
		// Directory missing or unreadable → empty set
	}

	return entries;
}

/**
 * Search stored memory entries with keyword + recency scoring.
 *
 * Optionally filters by tags (keeps entries with ≥1 matching tag),
 * scores each entry against the query, sorts descending, and returns
 * up to `max_results` (default 10).
 */
export async function recall(input: RecallInput): Promise<RecallResult> {
	const maxResults = input.max_results ?? 10;
	const now = input.now ?? Date.now();

	let entries = await readEntries(input.directory);

	if (input.tags && input.tags.length > 0) {
		const filterTags = new Set(input.tags.map((t) => t.toLowerCase()));
		entries = entries.filter((e) => {
			if (!e.tags || e.tags.length === 0) return false;
			return e.tags.some((t) => filterTags.has(t.toLowerCase()));
		});
	}

	const scored = entries.map((entry) => ({
		entry,
		score: scoreRecall(entry, input.query, {
			now,
			score_recency_24h: input.score_recency_24h ?? DEFAULT_CONFIG.score_recency_24h,
			score_recency_7d: input.score_recency_7d ?? DEFAULT_CONFIG.score_recency_7d,
			score_tag_exact: input.score_tag_exact ?? DEFAULT_CONFIG.score_tag_exact,
		}),
	}));

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return b.entry.created_at.localeCompare(a.entry.created_at);
	});

	const top = scored.slice(0, maxResults);

	return {
		count: top.length,
		results: top.map(({ entry, score }) => ({
			id: entry.id,
			created_at: entry.created_at,
			agent_path: entry.agent_path,
			tags: entry.tags ?? [],
			context: entry.context ?? null,
			content: entry.body,
			score,
		})),
		query: input.query,
	};
}

/**
 * Write a transcript file under `<dir>/transcripts/`.
 *
 * Uses the session ID as the filename for upsert semantics (same session
 * overwrites). When `compactId` is provided, the filename becomes
 * `<session_id>-compact-<compactId>.md`.
 */
export async function writeTranscript(input: WriteTranscriptInput): Promise<void> {
	const transcriptsDir = `${input.directory}/transcripts`;
	await ensureDirectory(transcriptsDir);

	const id = generateMemoryId();
	const now = new Date().toISOString();

	const filename = input.compactId
		? `${input.session_id}-compact-${input.compactId}.md`
		: `${input.session_id}.md`;

	const entry: MemoryEntry = {
		id,
		created_at: now,
		agent_path: input.agent_path,
		session_id: input.session_id,
		operator_id: input.operator_id,
		kind: "transcript",
		body: input.body,
	};
	if (input.tags && input.tags.length > 0) entry.tags = [...input.tags];
	if (input.context) entry.context = input.context;

	await Bun.write(`${transcriptsDir}/${filename}`, buildEntryFile(entry));
}

/**
 * Create the store root directory and write the README if it doesn't exist.
 *
 * Existing READMEs are preserved (the operator may have customized them).
 */
export async function ensureStoreReady(input: EnsureStoreReadyInput): Promise<void> {
	await ensureDirectory(input.storeRoot);

	const readmePath = `${input.storeRoot}/README.md`;
	if (!(await Bun.file(readmePath).exists())) {
		await Bun.write(
			readmePath,
			renderReadmeContent({
				project_id: input.project_id,
				store_description: input.store_description,
			}),
		);
	}
}

/**
 * Read the most recent `kind: retain` entries from a directory,
 * sorted by `created_at` descending.
 */
export async function getRecentRetains(
	directory: string,
	maxEntries: number,
): Promise<MemoryEntry[]> {
	const entries = await readEntries(directory);
	const retains = entries.filter((e) => e.kind === "retain");

	retains.sort((a, b) => b.created_at.localeCompare(a.created_at));

	return retains.slice(0, maxEntries);
}

/**
 * Format a list of memory entries as a markdown bulleted list for
 * `on_session_start` / `post_compact` injection.
 *
 * Returns `null` if the list is empty (caller should omit the inject).
 */
export function formatInjection(
	entries: ReadonlyArray<MemoryEntry>,
	options: {
		header?: string;
		inject_tag_hint?: boolean;
		known_tags?: readonly string[];
	} = {},
): string | null {
	if (entries.length === 0) return null;

	const header = options.header ?? DEFAULT_CONFIG.custom_inject_header;
	const lines = entries.map((entry) => {
		const tagPrefix = entry.tags && entry.tags.length > 0 ? `[${entry.tags.join(", ")}] ` : "";
		const body = entry.body.trim().replace(/\n+/g, " ");
		return `- ${tagPrefix}${body}`;
	});
	const sections = [header, lines.join("\n")];

	if (options.inject_tag_hint && options.known_tags && options.known_tags.length > 0) {
		sections.push(`Known tags: ${options.known_tags.join(", ")}`);
	}

	return sections.join("\n");
}

export async function deleteEntry(directory: string, id: string): Promise<ForgetResult> {
	const filePath = `${directory}/${id}.md`;
	const file = Bun.file(filePath);

	if (!(await file.exists())) {
		return { status: "not_found", id };
	}

	await file.delete();
	return { status: "forgotten", id };
}

export async function collectTags(directory: string): Promise<ListTagsResult> {
	const entries = await readEntries(directory);
	const tags = new Set<string>();

	for (const entry of entries) {
		for (const tag of entry.tags ?? []) {
			tags.add(tag.toLowerCase());
		}
	}

	const sortedTags = [...tags].sort((a, b) => a.localeCompare(b));
	return { tags: sortedTags, count: sortedTags.length };
}

// -- Internal helpers ---

function isDiscreteFact(content: string, factMaxLength: number): boolean {
	if (content.length >= factMaxLength) return false;
	if (content.includes("\n")) return false;
	if (/^#{1,6}\s/.test(content)) return false;
	if (content.startsWith("- ") || content.startsWith("* ")) return false;
	if (content.includes("```")) return false;
	return true;
}

async function appendToFacts(directory: string, content: string): Promise<void> {
	const factsPath = `${directory}/facts.md`;
	const file = Bun.file(factsPath);
	const bullet = `- ${content}\n`;

	if (await file.exists()) {
		const existing = await file.text();
		const sep = existing.endsWith("\n") ? "" : "\n";
		await Bun.write(factsPath, existing + sep + bullet);
	} else {
		await Bun.write(factsPath, bullet);
	}
}

async function ensureDirectory(directory: string): Promise<void> {
	const process = Bun.spawn(["mkdir", "-p", directory], {
		stdout: "ignore",
		stderr: "pipe",
	});
	const exitCode = await process.exited;

	if (exitCode === 0) {
		return;
	}

	const stderr = process.stderr ? await new Response(process.stderr).text() : "";
	throw new Error(`Failed to create directory ${directory}: ${stderr.trim()}`);
}
