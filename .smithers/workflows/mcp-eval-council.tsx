// smithers-source: seeded
// smithers-display-name: MCP Eval Council
/** @jsxImportSource smithers-orchestrator */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  ClaudeCodeAgent,
  CodexAgent,
  createSmithers,
  KimiAgent,
} from "smithers-orchestrator";
import { z } from "zod/v4";
import { agents, providers } from "../agents";
import EvalMcpLanePrompt from "../prompts/eval-mcp-lane.mdx";
import SynthesizeEvalReportPrompt from "../prompts/synthesize-eval-report.mdx";

const CONFIG_DIR = ".smithers/tmp/eval";
const REPORT_DIR = "docs/investigations/fff-pass-through/evals";
const WORKFLOW_PATH = ".smithers/workflows/mcp-eval-council.tsx";

const inputSchema = z.object({
  reportDate: z.string().default("2026-07-17"),
  maxConcurrency: z.number().int().min(1).max(8).default(4),
  planPath: z
    .string()
    .default(
      "docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md"
    ),
  repoRoot: z.string().default(process.cwd()),
});

const prepareOutputSchema = z.object({
  buildOk: z.boolean(),
  configDir: z.string(),
  claudeMcpConfigPath: z.string(),
  kimiMcpConfigPath: z.string(),
  codexConfigOverrides: z.array(z.string()).default([]),
  managedTools: z.array(z.string()).default([]),
  nativeTools: z.array(z.string()).default([]),
  summary: z.string(),
});

const ratingsSchema = z.object({
  managedParity: z.number().int().min(1).max(10),
  failClosedCorrectness: z.number().int().min(1).max(10),
  boundaryEnforcement: z.number().int().min(1).max(10),
  docsAccuracy: z.number().int().min(1).max(10),
  acceptanceExamples: z.number().int().min(1).max(10),
});

const issueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string(),
  repro: z.string(),
  evidence: z.string(),
});

const evidenceSchema = z.object({
  managedToolsList: z.string(),
  searchSessions: z.string(),
  nativeCapabilities: z.string(),
  nativeValidSourceGrep: z.string(),
  nativeOmittedSourceGrep: z.string(),
  nativeBogusSourceGrep: z.string(),
  cliCapabilities: z.string(),
  cliDoctor: z.string(),
  cliSearch: z.string(),
});

const evaluationOutputSchema = z.object({
  model: z.string(),
  ratings: ratingsSchema,
  evidence: evidenceSchema,
  issues: z.array(issueSchema).default([]),
  summary: z.string(),
});

const synthesisOutputSchema = z.object({
  reportPath: z.string(),
  overallRating: z.number().int().min(1).max(10),
  issueCount: z.number().int().min(0),
  summary: z.string(),
});

const verificationOutputSchema = z.object({
  graphOk: z.boolean(),
  typecheckOk: z.boolean(),
  reportExists: z.boolean(),
  summary: z.string(),
});

const { Workflow, Task, Sequence, Parallel, smithers, outputs } =
  createSmithers({
    input: inputSchema,
    prepare: prepareOutputSchema,
    evaluation: evaluationOutputSchema,
    synthesis: synthesisOutputSchema,
    verification: verificationOutputSchema,
  });

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type ProbeResult = {
  tools: string[];
};

void agents;

function inputWithDefaults(input: Partial<z.infer<typeof inputSchema>>) {
  return {
    reportDate: input.reportDate ?? "2026-07-17",
    maxConcurrency: input.maxConcurrency ?? 4,
    planPath:
      input.planPath ??
      "docs/plans/2026-07-16-002-feat-fff-two-lane-architecture-plan.md",
    repoRoot: input.repoRoot ?? process.cwd(),
  };
}

function repoAbsolute(repoRoot: string, candidate: string) {
  return path.isAbsolute(candidate)
    ? candidate
    : path.resolve(repoRoot, candidate);
}

function configPlan(repoRoot: string) {
  const root = repoAbsolute(process.cwd(), repoRoot);
  const configDir = path.join(root, CONFIG_DIR);
  const managedServer = path.join(root, "dist/server.js");
  const nativeServer = path.join(root, "dist/native-server.js");
  const claudeMcpConfigPath = path.join(configDir, "claude-mcp.json");
  const kimiMcpConfigPath = path.join(configDir, "kimi-mcp.json");
  const codexConfigPath = path.join(configDir, "codex-mcp-args.json");
  const codexConfigOverrides = [
    "mcp_servers.agent-session-search.command=node",
    `mcp_servers.agent-session-search.args=${JSON.stringify([managedServer])}`,
    "mcp_servers.fff-native.command=node",
    `mcp_servers.fff-native.args=${JSON.stringify([nativeServer])}`,
  ];

  return {
    root,
    configDir,
    managedServer,
    nativeServer,
    claudeMcpConfigPath,
    kimiMcpConfigPath,
    codexConfigPath,
    codexConfigOverrides,
  };
}

function mcpConfig(managedServer: string, nativeServer: string) {
  return {
    mcpServers: {
      "agent-session-search": {
        command: "node",
        args: [managedServer],
      },
      "fff-native": {
        command: "node",
        args: [nativeServer],
      },
    },
  };
}

function writeJsonFile(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tail(text: string, max = 4000) {
  return text.length > max ? text.slice(text.length - max) : text;
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`
        )
      );
    }, options.timeoutMs ?? 1_800_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

async function runChecked(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number }
) {
  const result = await runCommand(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.exitCode}.`,
        `stdout tail:\n${tail(result.stdout)}`,
        `stderr tail:\n${tail(result.stderr)}`,
      ].join("\n\n")
    );
  }
  return result;
}

function probeServer(command: string, args: string[], cwd: string) {
  return new Promise<ProbeResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error: Error | null, result?: ProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) {
        reject(error);
      } else {
        resolve(result ?? { tools: [] });
      }
    };

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `MCP probe timed out for ${args.join(" ")}. stderr tail:\n${tail(stderr)}`
        )
      );
    }, 30_000);

    const send = (message: unknown) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const handleMessage = (message: Record<string, unknown>) => {
      if (message.id === 1) {
        send({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (message.id === 2) {
        if (message.error) {
          finish(
            new Error(`tools/list failed: ${JSON.stringify(message.error)}`)
          );
          return;
        }
        const result = message.result;
        const tools =
          result && typeof result === "object" && "tools" in result
            ? (result as { tools?: unknown }).tools
            : [];
        const names = Array.isArray(tools)
          ? tools
              .map((tool) =>
                tool && typeof tool === "object" && "name" in tool
                  ? String((tool as { name: unknown }).name)
                  : ""
              )
              .filter(Boolean)
              .sort()
          : [];
        finish(null, { tools: names });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newlineIndex = stdout.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdout.slice(0, newlineIndex).trim();
        stdout = stdout.slice(newlineIndex + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === "object") {
              handleMessage(parsed);
            }
          } catch {
            stderr += `\nUnparseable stdout line: ${line}`;
          }
        }
        newlineIndex = stdout.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) => {
      if (!settled && exitCode !== null && exitCode !== 0) {
        finish(
          new Error(
            `MCP probe child exited with ${exitCode}. stderr tail:\n${tail(stderr)}`
          )
        );
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-eval-council", version: "1" },
      },
    });
  });
}

function normalizeCodexConfig(config: unknown) {
  if (!config) {
    return [];
  }
  if (Array.isArray(config)) {
    return config.map(String);
  }
  if (typeof config === "object") {
    return Object.entries(config).map(([key, value]) => {
      if (value === null) {
        return `${key}=null`;
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return `${key}=${value}`;
      }
      return `${key}=${JSON.stringify(value)}`;
    });
  }
  return [String(config)];
}

function makeKimiAgent(mcpConfigFile: string) {
  return new KimiAgent({
    ...providers.kimiK3.opts,
    mcpConfigFile: [mcpConfigFile],
  });
}

function makeFableAgent(mcpConfig: string) {
  return new ClaudeCodeAgent({
    ...providers.fable.opts,
    mcpConfig: [mcpConfig],
    strictMcpConfig: true,
    disallowedTools: [
      "Edit",
      "MultiEdit",
      "Write",
      "NotebookEdit",
      "git commit",
      "git push",
    ],
    permissionMode: "dontAsk",
  });
}

function makeCodexAgent(base: CodexAgent, overrides: string[]) {
  return new CodexAgent({
    ...base.opts,
    sandbox: "read-only",
    config: [...normalizeCodexConfig(base.opts.config), ...overrides],
  });
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function schemaText(schema: z.ZodObject<z.ZodRawShape>) {
  return formatJson(z.toJSONSchema(schema));
}

async function prepare(repoRoot: string) {
  const plan = configPlan(repoRoot);
  await runChecked("npm", ["run", "build"], {
    cwd: plan.root,
    timeoutMs: 1_800_000,
  });

  mkdirSync(plan.configDir, { recursive: true });
  const config = mcpConfig(plan.managedServer, plan.nativeServer);
  writeJsonFile(plan.claudeMcpConfigPath, config);
  writeJsonFile(plan.kimiMcpConfigPath, config);
  writeJsonFile(plan.codexConfigPath, plan.codexConfigOverrides);
  const codexConfigOverrides = JSON.parse(
    readFileSync(plan.codexConfigPath, "utf8")
  ) as string[];

  const [managedProbe, nativeProbe] = await Promise.all([
    probeServer("node", [plan.managedServer], plan.root),
    probeServer("node", [plan.nativeServer], plan.root),
  ]);

  return {
    buildOk: true,
    configDir: plan.configDir,
    claudeMcpConfigPath: plan.claudeMcpConfigPath,
    kimiMcpConfigPath: plan.kimiMcpConfigPath,
    codexConfigOverrides,
    managedTools: managedProbe.tools,
    nativeTools: nativeProbe.tools,
    summary: `Build passed and MCP probes found managed tools [${managedProbe.tools.join(
      ", "
    )}] and native tools [${nativeProbe.tools.join(", ")}].`,
  };
}

async function verifyScaffold(repoRoot: string, reportPath: string) {
  const root = repoAbsolute(process.cwd(), repoRoot);
  const graph = await runCommand(
    "bunx",
    ["smithers-orchestrator", "graph", WORKFLOW_PATH],
    { cwd: root, timeoutMs: 1_800_000 }
  );
  const typecheck = await runCommand("bun", ["run", "typecheck"], {
    cwd: path.join(root, ".smithers"),
    timeoutMs: 1_800_000,
  });
  const resolvedReportPath = repoAbsolute(root, reportPath);
  const reportExists =
    existsSync(resolvedReportPath) && statSync(resolvedReportPath).size > 0;

  if (graph.exitCode !== 0 || typecheck.exitCode !== 0 || !reportExists) {
    throw new Error(
      [
        `graph exit: ${graph.exitCode}`,
        `graph stderr tail:\n${tail(graph.stderr)}`,
        `typecheck exit: ${typecheck.exitCode}`,
        `typecheck stderr tail:\n${tail(typecheck.stderr)}`,
        `report exists and non-empty: ${reportExists}`,
        `report path: ${resolvedReportPath}`,
      ].join("\n\n")
    );
  }

  return {
    graphOk: true,
    typecheckOk: true,
    reportExists,
    summary:
      "Graph render, Smithers typecheck, and synthesized report check passed.",
  };
}

export default smithers((ctx) => {
  const input = inputWithDefaults(ctx.input);
  const prepareResult = ctx.outputMaybe("prepare", { nodeId: "prepare" });
  const evalKimi = ctx.outputMaybe("evaluation", { nodeId: "eval-kimi" });
  const evalCodexXhigh = ctx.outputMaybe("evaluation", {
    nodeId: "eval-codex-xhigh",
  });
  const evalFable = ctx.outputMaybe("evaluation", { nodeId: "eval-fable" });
  const evalCodexHigh = ctx.outputMaybe("evaluation", {
    nodeId: "eval-codex-high",
  });
  const synthesis = ctx.outputMaybe("synthesis", { nodeId: "synthesize" });
  const plannedConfig = configPlan(input.repoRoot);
  const codexConfigOverrides =
    prepareResult?.codexConfigOverrides ?? plannedConfig.codexConfigOverrides;
  const baseline = prepareResult
    ? formatJson(prepareResult)
    : formatJson({
        managedTools: [],
        nativeTools: [],
        summary: "Prepare has not completed yet.",
      });
  const evaluationSchema = schemaText(evaluationOutputSchema);
  const synthesisSchema = schemaText(synthesisOutputSchema);

  return (
    <Workflow name="mcp-eval-council">
      <Sequence>
        <Task
          id="prepare"
          output={outputs.prepare}
          outputSchema={prepareOutputSchema}
          timeoutMs={1_800_000}
        >
          {async () => prepare(input.repoRoot)}
        </Task>

        <Parallel id="evaluations" maxConcurrency={input.maxConcurrency}>
          <Task
            id="eval-kimi"
            agent={[
              makeKimiAgent(
                prepareResult?.kimiMcpConfigPath ??
                  plannedConfig.kimiMcpConfigPath
              ),
              // Fallback insurance: if the kimi provider wedges, the
              // evaluation still completes on Codex Sol medium (eval-tier
              // effort; max is overkill for review work).
              makeCodexAgent(providers.codex56SolMed, codexConfigOverrides),
            ]}
            output={outputs.evaluation}
            outputSchema={evaluationOutputSchema}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ prepare: "prepare" }}
            deps={{ prepare: prepareOutputSchema }}
          >
            {(deps) => (
              <EvalMcpLanePrompt
                role="kimiK3"
                harness="kimi"
                planPath={input.planPath}
                repoRoot={input.repoRoot}
                baseline={formatJson(deps.prepare)}
                schema={evaluationSchema}
              />
            )}
          </Task>

          <Task
            id="eval-codex-xhigh"
            agent={makeCodexAgent(
              providers.codex56SolXHigh,
              codexConfigOverrides
            )}
            output={outputs.evaluation}
            outputSchema={evaluationOutputSchema}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ prepare: "prepare" }}
            deps={{ prepare: prepareOutputSchema }}
          >
            {(deps) => (
              <EvalMcpLanePrompt
                role="codex56SolXHigh"
                harness="codex"
                planPath={input.planPath}
                repoRoot={input.repoRoot}
                baseline={formatJson(deps.prepare)}
                schema={evaluationSchema}
              />
            )}
          </Task>

          <Task
            id="eval-fable"
            agent={makeFableAgent(
              prepareResult?.claudeMcpConfigPath ??
                plannedConfig.claudeMcpConfigPath
            )}
            output={outputs.evaluation}
            outputSchema={evaluationOutputSchema}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ prepare: "prepare" }}
            deps={{ prepare: prepareOutputSchema }}
          >
            {(deps) => (
              <EvalMcpLanePrompt
                role="fable"
                harness="claude"
                planPath={input.planPath}
                repoRoot={input.repoRoot}
                baseline={formatJson(deps.prepare)}
                schema={evaluationSchema}
              />
            )}
          </Task>

          <Task
            id="eval-codex-high"
            agent={makeCodexAgent(
              providers.codex56SolHigh,
              codexConfigOverrides
            )}
            output={outputs.evaluation}
            outputSchema={evaluationOutputSchema}
            timeoutMs={1_800_000}
            heartbeatTimeoutMs={600_000}
            needs={{ prepare: "prepare" }}
            deps={{ prepare: prepareOutputSchema }}
          >
            {(deps) => (
              <EvalMcpLanePrompt
                role="codex56SolHigh"
                harness="codex"
                planPath={input.planPath}
                repoRoot={input.repoRoot}
                baseline={formatJson(deps.prepare)}
                schema={evaluationSchema}
              />
            )}
          </Task>
        </Parallel>

        <Task
          id="synthesize"
          agent={makeKimiAgent(
            prepareResult?.kimiMcpConfigPath ?? plannedConfig.kimiMcpConfigPath
          )}
          output={outputs.synthesis}
          outputSchema={synthesisOutputSchema}
          timeoutMs={1_800_000}
          heartbeatTimeoutMs={600_000}
          needs={{
            prepare: "prepare",
            kimi: "eval-kimi",
            codexXhigh: "eval-codex-xhigh",
            fable: "eval-fable",
            codexHigh: "eval-codex-high",
          }}
          deps={{
            prepare: prepareOutputSchema,
            kimi: evaluationOutputSchema,
            codexXhigh: evaluationOutputSchema,
            fable: evaluationOutputSchema,
            codexHigh: evaluationOutputSchema,
          }}
        >
          {(deps) => (
            <SynthesizeEvalReportPrompt
              reportDate={input.reportDate}
              reportPath={`${REPORT_DIR}/${input.reportDate}-native-lane-eval.md`}
              planPath={input.planPath}
              repoRoot={input.repoRoot}
              baseline={formatJson(deps.prepare)}
              evaluations={formatJson([
                deps.kimi,
                deps.codexXhigh,
                deps.fable,
                deps.codexHigh,
              ])}
              schema={synthesisSchema}
            />
          )}
        </Task>

        {synthesis ? (
          <Task
            id="verify-scaffold"
            output={outputs.verification}
            outputSchema={verificationOutputSchema}
            timeoutMs={1_800_000}
          >
            {async () => verifyScaffold(input.repoRoot, synthesis.reportPath)}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
