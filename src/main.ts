import { PluginServer } from "./server.ts";

const configRoot = process.env.KAGED_CONFIG_ROOT ?? `${process.env.HOME}/.config/kaged`;
const projectRoot = process.env.KAGED_PROJECT_ROOT ?? process.cwd();
const projectId = process.env.KAGED_PROJECT_ID ?? "unknown";

const server = new PluginServer({
	write: (line) => process.stdout.write(`${line}\n`),
	resolve: {
		project_id: projectId,
		project_root: projectRoot,
		config_root: configRoot,
	},
});

const decoder = new TextDecoder();
let buffer = "";

async function processStdin(): Promise<void> {
	for await (const chunk of Bun.stdin.stream()) {
		buffer += decoder.decode(chunk, { stream: true });

		let newlineIdx = buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = buffer.slice(0, newlineIdx);
			buffer = buffer.slice(newlineIdx + 1);
			await server.handleLine(line);
			newlineIdx = buffer.indexOf("\n");
		}
	}
}

processStdin().catch((err) => {
	process.stderr.write(`memory-markdown: fatal: ${err}\n`);
	process.exit(1);
});
