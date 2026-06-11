export interface ResolveContext {
	project_id: string;
	project_root: string;
	config_root: string;
}

type Scheme = "config" | "project";

interface ParsedUri {
	scheme: Scheme;
	path: string;
}

export function resolveStoreUri(uri: string, ctx: ResolveContext): string {
	if (!uri) throw new Error("URI must be a non-empty string");

	const parsed = parseUri(uri);

	if (parsed.scheme === "config") {
		if (!ctx.config_root) {
			throw new Error("config_root must be set to resolve config:/ URIs");
		}
		if (!ctx.project_id) {
			throw new Error("project_id must be set to resolve config:/ URIs");
		}
		return joinPath(ctx.config_root, parsed.path, ctx.project_id);
	}

	if (!ctx.project_root) {
		throw new Error("project_root must be set to resolve project:/ URIs");
	}

	return joinPath(ctx.project_root, parsed.path);
}

function parseUri(uri: string): ParsedUri {
	const colonIdx = uri.indexOf(":");
	if (colonIdx === -1) {
		throw new Error(
			`URI scheme missing — expected "config:/..." or "project:/..." (got: "${uri}")`,
		);
	}
	const scheme = uri.slice(0, colonIdx);
	if (scheme !== "config" && scheme !== "project") {
		throw new Error(
			`Unsupported URI scheme "${scheme}" — only "config:" and "project:" are allowed (got: "${uri}")`,
		);
	}
	const rest = uri.slice(colonIdx + 1);
	if (!rest.startsWith("/")) {
		throw new Error(`URI scheme "${scheme}:" must be followed by "/" (got: "${uri}")`);
	}
	const path = stripTrailingSlash(rest.slice(1));
	rejectTraversal(path);
	return { scheme, path };
}

function rejectTraversal(path: string): void {
	if (!path) return;
	const segments = path.split("/");
	for (const segment of segments) {
		if (segment === ".." || segment === ".") {
			throw new Error(`path traversal rejected: segment "${segment}" in "${path}"`);
		}
	}
}

function stripTrailingSlash(path: string): string {
	if (path.length > 0 && path.endsWith("/")) return path.slice(0, -1);
	return path;
}

function joinPath(...parts: string[]): string {
	const cleaned = parts.filter((p) => p.length > 0).map(stripTrailingSlash);
	return cleaned.join("/");
}
