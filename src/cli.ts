import { INPUT_DEFAULTS, TOP_K_DEFAULT } from "./core/constants.js";
import { runPipeline } from "./pipeline.js";

interface Flags {
  tickets: string;
  kb: string;
  policy: string;
  out: string;
  provider: string;
  topK: number;
  help: boolean;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Flags {
  const f: Flags = {
    tickets: INPUT_DEFAULTS.tickets,
    kb: INPUT_DEFAULTS.kb,
    policy: INPUT_DEFAULTS.policy,
    out: ".",
    provider: env.LLM_PROVIDER ?? "openai",
    topK: TOP_K_DEFAULT,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--help" || a === "-h") {
      f.help = true;
      continue;
    }
    if (next === undefined) continue;
    if (a === "--tickets") f.tickets = next;
    else if (a === "--kb") f.kb = next;
    else if (a === "--policy") f.policy = next;
    else if (a === "--out") f.out = next;
    else if (a === "--provider") f.provider = next;
    else if (a === "--top-k") f.topK = Number.parseInt(next, 10) || TOP_K_DEFAULT;
    else continue;
    i += 1;
  }
  return f;
}

const USAGE = `Usage: npm start -- [options]

  --tickets <path>   default ${INPUT_DEFAULTS.tickets}
  --kb <path>        default ${INPUT_DEFAULTS.kb}
  --policy <path>    default ${INPUT_DEFAULTS.policy}
  --out <dir>        default . (repo root)
  --provider <name>  openai | mock   (or set LLM_PROVIDER)
  --top-k <n>        default ${TOP_K_DEFAULT}

Set OPENAI_API_KEY for the openai provider, or use --provider mock to run with no secret.`;

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2), process.env);
  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const result = await runPipeline({
    paths: { tickets: flags.tickets, kb: flags.kb, policy: flags.policy },
    outDir: flags.out,
    providerName: flags.provider,
    topK: flags.topK,
  });
  if (!result.ok) {
    const { identity, message, detail } = result.error;
    process.stderr.write(`FAILED [${identity}] ${message}${detail ? `\n  ${detail}` : ""}\n`);
    process.exitCode = 1;
    return;
  }
  const s = result.value;
  const lines = [
    `Triaged ${s.ticketCount} ticket(s) with provider "${flags.provider}".`,
    ...Object.entries(s.decisions).sort().map(([d, n]) => `  ${d}: ${n}`),
    s.repairedTickets.length > 0 ? `  repaired: ${s.repairedTickets.join(", ")}` : "",
    s.templatedTickets.length > 0 ? `  templated: ${s.templatedTickets.join(", ")}` : "",
    "Artifacts:",
    ...s.artifacts.map((a) => `  ${a}`),
  ].filter((l) => l !== "");
  process.stdout.write(`${lines.join("\n")}\n`);
}

await main();
