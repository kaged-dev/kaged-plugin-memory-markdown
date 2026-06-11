export type Isolation = "agent" | "project";

export interface StoreLayoutInput {
	store: string;
	agentPath: string;
	isolation: Isolation;
}

export interface StoreLayoutResult {
	directory: string;
}

const PRIMARY_PREFIX = "primary";
const SUBAGENTS_TOKEN = "subagents";

export function resolveStoreDirectory(input: StoreLayoutInput): StoreLayoutResult {
	const { store, agentPath, isolation } = input;

	if (!store) {
		throw new Error("store must be a non-empty path");
	}
	if (isolation !== "agent" && isolation !== "project") {
		throw new Error(`isolation must be "agent" or "project", got: ${isolation}`);
	}

	const base = trimTrailingSlash(store);

	if (isolation === "project") {
		return { directory: `${base}/project` };
	}

	if (agentPath === PRIMARY_PREFIX) {
		return { directory: `${base}/agent` };
	}

	const keys = parseSubagentKeys(agentPath);
	return { directory: `${base}/subagent/${keys.join(".")}` };
}

function parseSubagentKeys(agentPath: string): string[] {
	if (!agentPath.startsWith(`${PRIMARY_PREFIX}.`)) {
		throw new Error(`agent path must start with "primary" or "primary.": ${agentPath}`);
	}

	const rest = agentPath.slice(PRIMARY_PREFIX.length + 1);
	const segments = rest.split(".");
	const keys: string[] = [];

	let i = 0;
	while (i < segments.length) {
		if (segments[i] !== SUBAGENTS_TOKEN) {
			throw new Error(
				`malformed agent path: expected "${SUBAGENTS_TOKEN}" at segment ${i + 1}, got "${segments[i]}" in "${agentPath}"`,
			);
		}
		const key = segments[i + 1];
		if (!key) {
			throw new Error(
				`malformed agent path: "${SUBAGENTS_TOKEN}" without a following key in "${agentPath}"`,
			);
		}
		keys.push(key);
		i += 2;
	}

	if (keys.length === 0) {
		throw new Error(`malformed agent path: no subagent keys found in "${agentPath}"`);
	}
	return keys;
}

function trimTrailingSlash(path: string): string {
	if (path.length > 1 && path.endsWith("/")) {
		return path.slice(0, -1);
	}
	return path;
}
