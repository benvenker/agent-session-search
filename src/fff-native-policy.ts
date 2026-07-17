import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import type { RouterCallResult } from "./fff-capability-router.js";
import type { SourceName } from "./types.js";

export const FFF_NATIVE_POLICY_VERSION = 1;
export const FFF_NATIVE_METADATA_KEY =
  "dev.benvenker.agent-session-search/native";
export const FFF_NATIVE_DEFAULT_MAX_RESULTS = 50;
export const FFF_NATIVE_MAX_RESULTS = 200;
export const FFF_NATIVE_MAX_ATTEMPTED_CALLS = 256;
export const FFF_NATIVE_MAX_CONCURRENT_CALLS = 4;
export const FFF_NATIVE_MAX_RESULT_BYTES = 4 * 1024 * 1024;

export type NativePolicyClassification =
  | "internal"
  | "exposable"
  | "denied"
  | "unknown";

export type NativePolicyEntry = {
  name: string;
  fingerprint: string;
  classifications: NativePolicyClassification[];
  maxResultsDefault?: number;
  maxResultsCeiling?: number;
  annotations?: Record<string, unknown>;
};

export type NativePolicyDecision =
  | {
      status: "approved";
      tool: Tool;
      upstreamName: string;
      projectedName: string;
      entry: NativePolicyEntry;
      validator(input: unknown):
        | { valid: true; data: NativeCallArguments }
        | {
            valid: false;
            error: string;
          };
    }
  | {
      status: "blocked";
      tool: Tool;
      reason: NativeBlockedReason;
      fingerprint: string;
      entry?: NativePolicyEntry;
    };

export type NativeBlockedReason =
  | "unknown_tool"
  | "definition_drift"
  | "unsafe_schema"
  | "reserved_name"
  | "source_collision"
  | "policy_denied"
  | "policy_not_exposable"
  | "policy_unknown"
  | "policy_invalid";

export type NativeCallArguments = {
  source: SourceName;
  upstreamArgs: Record<string, unknown>;
};

export type NativeSourceToolCatalog = {
  source: SourceName;
  tools: Tool[];
};

export type NativeCatalogDecision = NativePolicyDecision & {
  sourceDecisions?: Array<{
    source: SourceName;
    status: "approved" | "blocked" | "missing";
    reason?: NativeBlockedReason | "missing_tool";
    fingerprint?: string;
  }>;
};

export type NativeCallBudgetOptions = {
  maxAttempts?: number;
  maxConcurrent?: number;
  timeoutMs?: number;
  maxResultBytes?: number;
};

export type BudgetedCallError =
  | "native_call_budget_exhausted"
  | "native_call_concurrency_exhausted"
  | "native_call_timeout"
  | "native_upstream_error"
  | "native_result_too_large"
  | "native_result_metadata_collision";

export const SUPPORTED_FFF_FIND_FILES_TOOL: Tool = {
  name: "find_files",
  description:
    "Fuzzy file search by name. Searches FILE NAMES, not file contents. Use it when you need to find a file, not a definition. Use grep instead for searching code content (definitions, usage patterns). Supports fuzzy matching, path prefixes ('src/'), and glob constraints ('name **/src/*.{ts,tsx} !test/'). IMPORTANT: Keep queries SHORT — prefer 1-2 terms max. Multiple words are a waterfall (each narrows results), NOT OR. If unsure, start broad with 1 term and refine.",
  inputSchema: {
    type: "object",
    properties: {
      cursor: {
        description:
          "Cursor from previous result. Only use if previous results weren't sufficient.",
        type: ["string", "null"],
      },
      maxResults: {
        description: "Max results (default 20).",
        format: "double",
        type: ["number", "null"],
      },
      query: {
        description:
          "Fuzzy search query. Supports path prefixes and glob constraints.",
        type: "string",
      },
    },
    required: ["query"],
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "FindFilesParams",
  },
};

export const SUPPORTED_FFF_GREP_TOOL: Tool = {
  name: "grep",
  description:
    "Search file contents. Search for bare identifiers (e.g. 'InProgressQuote', 'ActorAuth'), NOT code syntax or regex. Filter files with constraints (e.g. '*.rs query', 'src/ query'). Use filename, directory (ending with /) or glob expressions to prefilter. See server instructions for constraint syntax and core rules.",
  inputSchema: {
    type: "object",
    properties: {
      cursor: {
        description:
          "Cursor from previous result. Only use if previous results weren't sufficient.",
        type: ["string", "null"],
      },
      maxResults: {
        description: "Max matching lines (default 20).",
        format: "double",
        type: ["number", "null"],
      },
      output_mode: {
        description: "Output format (default 'content').",
        type: ["string", "null"],
      },
      query: {
        description:
          "Search text or regex query with optional constraint prefixes.\nMatches within single lines only — use ONE specific term, not multiple words.",
        type: "string",
      },
    },
    required: ["query"],
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "GrepParams",
  },
};

export const SUPPORTED_FFF_MULTI_GREP_TOOL: Tool = {
  name: "multi_grep",
  description:
    "Search file contents for lines matching ANY of multiple patterns (OR logic). IMPORTANT: This returns files where ANY query matches, NOT all patterns. Patterns are literal text — NEVER escape special characters (no \\( \\) \\. etc). Faster than regex alternation for literal text. See server instructions for constraint syntax.",
  inputSchema: {
    type: "object",
    properties: {
      constraints: {
        description:
          "File constraints (e.g. '*.{ts,tsx} !test/'). ALWAYS provide when possible.",
        type: ["string", "null"],
      },
      context: {
        description: "Context lines before/after each match.",
        format: "double",
        type: ["number", "null"],
      },
      cursor: {
        description: "Cursor from previous result.",
        type: ["string", "null"],
      },
      maxResults: {
        description: "Max matching lines (default 20).",
        format: "double",
        type: ["number", "null"],
      },
      output_mode: {
        description: "Output format (default 'content').",
        type: ["string", "null"],
      },
      patterns: {
        description:
          "Patterns to match (OR logic). Include all naming conventions: snake_case, PascalCase, camelCase.",
        items: {
          type: "string",
        },
        type: "array",
      },
    },
    required: ["patterns"],
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "MultiGrepParams",
  },
};

export const DEFAULT_FFF_NATIVE_POLICY: NativePolicyEntry[] = [
  {
    name: "find_files",
    fingerprint: fingerprintTool(SUPPORTED_FFF_FIND_FILES_TOOL),
    classifications: ["internal"],
  },
  {
    name: "grep",
    fingerprint: fingerprintTool(SUPPORTED_FFF_GREP_TOOL),
    classifications: ["internal", "exposable"],
    maxResultsDefault: FFF_NATIVE_DEFAULT_MAX_RESULTS,
    maxResultsCeiling: FFF_NATIVE_MAX_RESULTS,
    annotations: { readOnlyHint: true },
  },
  {
    name: "multi_grep",
    fingerprint: fingerprintTool(SUPPORTED_FFF_MULTI_GREP_TOOL),
    classifications: ["internal", "exposable"],
    maxResultsDefault: FFF_NATIVE_DEFAULT_MAX_RESULTS,
    maxResultsCeiling: FFF_NATIVE_MAX_RESULTS,
    annotations: { readOnlyHint: true },
  },
];

export function fingerprintTool(tool: Tool): string {
  return createHash("sha256").update(canonicalJson(tool)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function classifyNativeTool(input: {
  tool: Tool;
  sourceNames: SourceName[];
  policy?: NativePolicyEntry[];
}): NativePolicyDecision {
  const policy = input.policy ?? DEFAULT_FFF_NATIVE_POLICY;
  const fingerprint = fingerprintTool(input.tool);
  const projectedName = nativeToolName(input.tool.name);

  if (
    input.tool.name === "fff_native_capabilities" ||
    projectedName === "fff_native_capabilities"
  ) {
    return blocked(input.tool, "reserved_name", fingerprint);
  }

  if (!isJsonObject(input.tool.inputSchema)) {
    return blocked(input.tool, "unsafe_schema", fingerprint);
  }

  const properties = objectProperties(input.tool.inputSchema.properties);
  if (Object.hasOwn(properties, "source")) {
    return blocked(input.tool, "source_collision", fingerprint);
  }

  const entry = policy.find((candidate) => candidate.name === input.tool.name);
  if (!entry) {
    return blocked(input.tool, "unknown_tool", fingerprint);
  }
  if (!isValidPolicyEntry(entry)) {
    return blocked(input.tool, "policy_invalid", fingerprint, entry);
  }
  if (entry.classifications.includes("denied")) {
    return blocked(input.tool, "policy_denied", fingerprint, entry);
  }
  if (entry.classifications.includes("unknown")) {
    return blocked(input.tool, "policy_unknown", fingerprint, entry);
  }
  if (!entry.classifications.includes("exposable")) {
    return blocked(input.tool, "policy_not_exposable", fingerprint, entry);
  }
  if (entry.fingerprint !== fingerprint) {
    return blocked(input.tool, "definition_drift", fingerprint, entry);
  }

  const projected = projectNativeToolSchema({
    tool: input.tool,
    sourceNames: input.sourceNames,
    entry,
  });
  if (!projected) {
    return blocked(input.tool, "unsafe_schema", fingerprint);
  }
  const validator = compileNativeValidator(projected.inputSchema);
  return {
    status: "approved",
    tool: projected,
    upstreamName: input.tool.name,
    projectedName,
    entry,
    validator,
  };
}

export function assertAllToolsClassified(input: {
  tools: Tool[];
  policy?: NativePolicyEntry[];
}) {
  const policy = input.policy ?? DEFAULT_FFF_NATIVE_POLICY;
  const policyNames = new Set(policy.map((entry) => entry.name));
  const unclassified = input.tools
    .map((tool) => tool.name)
    .filter((name) => !policyNames.has(name));
  if (unclassified.length > 0) {
    throw new Error(
      `Unclassified FFF tools require policy review: ${unclassified.join(", ")}`
    );
  }
}

export function classifyNativeCatalog(input: {
  catalogs: NativeSourceToolCatalog[];
  policy?: NativePolicyEntry[];
}): NativeCatalogDecision[] {
  const policy = input.policy ?? DEFAULT_FFF_NATIVE_POLICY;
  if (input.catalogs.length === 0) {
    return [];
  }
  const catalogs = [...input.catalogs].sort((left, right) =>
    left.source.localeCompare(right.source)
  );
  const toolNames = Array.from(
    new Set(
      catalogs.flatMap((catalog) => catalog.tools.map((tool) => tool.name))
    )
  ).sort();

  return toolNames.map((toolName) => {
    const sourceDecisions = catalogs.map((catalog) => {
      const candidate = catalog.tools.find((entry) => entry.name === toolName);
      if (!candidate) {
        return {
          source: catalog.source,
          status: "missing" as const,
          reason: "missing_tool" as const,
        };
      }
      const decision = classifyNativeTool({
        tool: candidate,
        sourceNames: [catalog.source],
        policy,
      });
      return {
        source: catalog.source,
        status: decision.status,
        ...(decision.status === "blocked" ? { reason: decision.reason } : {}),
        fingerprint:
          decision.status === "blocked"
            ? decision.fingerprint
            : fingerprintTool(candidate),
      };
    });
    const blockedSource = sourceDecisions.find(
      (decision) => decision.status === "blocked"
    );
    const approvedSources = sourceDecisions
      .filter((decision) => decision.status === "approved")
      .map((decision) => decision.source);
    const tool =
      catalogs
        .flatMap((catalog) => catalog.tools)
        .find((candidate) => candidate.name === toolName) ??
      ({ name: toolName, inputSchema: { type: "object" } } as Tool);

    if (blockedSource || approvedSources.length === 0) {
      return {
        status: "blocked",
        tool,
        reason:
          blockedSource?.reason === "missing_tool"
            ? "definition_drift"
            : (blockedSource?.reason ?? "definition_drift"),
        fingerprint: fingerprintTool(tool),
        entry: policy.find((entry) => entry.name === toolName),
        sourceDecisions,
      };
    }

    const decision = classifyNativeTool({
      tool,
      sourceNames: approvedSources,
      policy,
    });
    return { ...decision, sourceDecisions };
  });
}

export function projectNativeToolSchema(input: {
  tool: Tool;
  sourceNames: SourceName[];
  entry?: NativePolicyEntry;
}): Tool | undefined {
  const schema = input.tool.inputSchema;
  if (!isJsonObject(schema)) {
    return undefined;
  }
  const properties = objectSchemaProperties(schema.properties);
  if (Object.hasOwn(properties, "source")) {
    return undefined;
  }

  const required = Array.isArray(schema.required)
    ? [...schema.required.filter((key) => key !== "maxResults"), "source"]
    : ["source"];
  const maxResultsCeiling =
    input.entry?.maxResultsCeiling ?? FFF_NATIVE_MAX_RESULTS;
  const maxResultsDefault =
    input.entry?.maxResultsDefault ?? FFF_NATIVE_DEFAULT_MAX_RESULTS;

  const projectedProperties: Record<string, object> = {
    ...properties,
    source: {
      type: "string",
      enum: input.sourceNames,
      description: "Configured Agent Session Search source name.",
    },
  };
  if (Object.hasOwn(projectedProperties, "maxResults")) {
    const currentMaxResults = projectedProperties.maxResults;
    const currentType = isJsonObject(currentMaxResults)
      ? currentMaxResults.type
      : undefined;
    const projectedType = Array.isArray(currentType)
      ? currentType.includes("number")
        ? currentType
        : "number"
      : currentType === "number" || currentType === "null"
        ? currentType
        : "number";
    projectedProperties.maxResults = {
      ...(isJsonObject(currentMaxResults) ? currentMaxResults : {}),
      type: projectedType,
      default: maxResultsDefault,
      maximum: maxResultsCeiling,
    };
  }

  return {
    ...input.tool,
    name: nativeToolName(input.tool.name),
    inputSchema: {
      ...schema,
      type: "object",
      properties: projectedProperties,
      required: uniqueStrings(required),
      additionalProperties: false,
    },
    annotations: {
      ...input.tool.annotations,
      ...input.entry?.annotations,
      readOnlyHint: true,
      destructiveHint: false,
    },
  };
}

export class NativeCallBudget {
  private attemptedCalls = 0;
  private activeCalls = 0;
  private readonly maxAttempts: number;
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;
  private readonly maxResultBytes: number;

  constructor(options: NativeCallBudgetOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? FFF_NATIVE_MAX_ATTEMPTED_CALLS;
    this.maxConcurrent =
      options.maxConcurrent ?? FFF_NATIVE_MAX_CONCURRENT_CALLS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResultBytes = options.maxResultBytes ?? FFF_NATIVE_MAX_RESULT_BYTES;
  }

  get remainingAttempts() {
    return Math.max(0, this.maxAttempts - this.attemptedCalls);
  }

  get active() {
    return this.activeCalls;
  }

  async run<T extends RouterCallResult>(
    operation: () => Promise<T>
  ): Promise<CallToolResult> {
    if (this.attemptedCalls >= this.maxAttempts) {
      return nativeErrorResult("native_call_budget_exhausted");
    }
    if (this.activeCalls >= this.maxConcurrent) {
      return nativeErrorResult("native_call_concurrency_exhausted");
    }
    this.attemptedCalls += 1;
    this.activeCalls += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.activeCalls -= 1;
      }
    };
    const operationPromise = Promise.resolve().then(operation).finally(release);
    try {
      const routed = await raceNativeCall(operationPromise, this.timeoutMs);
      if (routed === "native_call_timeout") {
        return nativeErrorResult("native_call_timeout");
      }
      return addNativeMetadata(routed, this.maxResultBytes);
    } catch (error) {
      if (error instanceof NativePolicyError) {
        return nativeErrorResult(error.code);
      }
      return nativeErrorResult("native_upstream_error", errorMessage(error));
    }
  }
}

export function addNativeMetadata(
  routed: RouterCallResult,
  maxBytes = FFF_NATIVE_MAX_RESULT_BYTES
): CallToolResult {
  const existingMeta = routed.result._meta ?? {};
  if (Object.hasOwn(existingMeta, FFF_NATIVE_METADATA_KEY)) {
    throw new NativePolicyError("native_result_metadata_collision");
  }
  const result = {
    ...routed.result,
    _meta: {
      ...existingMeta,
      [FFF_NATIVE_METADATA_KEY]: {
        source: routed.source,
        root: routed.root,
        tool: routed.tool,
      },
    },
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) {
    throw new NativePolicyError("native_result_too_large");
  }
  return result;
}

export function nativeErrorResult(
  code: BudgetedCallError,
  detail?: string
): CallToolResult {
  const boundedDetail = detail ? boundErrorDetail(detail) : undefined;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: boundedDetail ? `${code}: ${boundedDetail}` : code,
      },
    ],
  };
}

function compileNativeValidator(schema: Tool["inputSchema"]) {
  const validator = new AjvJsonSchemaValidator().getValidator<
    Record<string, unknown>
  >(schema);
  const allowedProperties = new Set(Object.keys(schema.properties ?? {}));
  return (
    input: unknown
  ):
    | { valid: true; data: NativeCallArguments }
    | {
        valid: false;
        error: string;
      } => {
    if (!isJsonObject(input)) {
      return { valid: false, error: "tool arguments must be an object" };
    }
    const unknownProperties = Object.keys(input).filter(
      (key) => !allowedProperties.has(key)
    );
    if (unknownProperties.length > 0) {
      return {
        valid: false,
        error: `Unknown argument(s): ${unknownProperties.join(", ")}`,
      };
    }
    const result = validator(input);
    if (!result.valid) {
      return { valid: false, error: result.errorMessage };
    }
    const source = result.data.source;
    if (typeof source !== "string") {
      return { valid: false, error: "source must be a string" };
    }
    const { source: _source, ...upstreamArgs } = result.data;
    if (
      upstreamArgs.maxResults === undefined &&
      Object.hasOwn(schema.properties ?? {}, "maxResults")
    ) {
      upstreamArgs.maxResults = FFF_NATIVE_DEFAULT_MAX_RESULTS;
    }
    return {
      valid: true,
      data: {
        source,
        upstreamArgs,
      },
    };
  };
}

function blocked(
  tool: Tool,
  reason: NativeBlockedReason,
  fingerprint: string,
  entry?: NativePolicyEntry
): NativePolicyDecision {
  return {
    status: "blocked",
    tool,
    reason,
    fingerprint,
    ...(entry ? { entry } : {}),
  };
}

function nativeToolName(name: string) {
  return `fff_${name}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectProperties(value: unknown): Record<string, unknown> {
  return isJsonObject(value) ? value : {};
}

function objectSchemaProperties(value: unknown): Record<string, object> {
  return Object.fromEntries(
    Object.entries(objectProperties(value)).filter(
      (entry): entry is [string, object] => isJsonObject(entry[1])
    )
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

class NativePolicyError extends Error {
  constructor(readonly code: BudgetedCallError) {
    super(code);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function boundErrorDetail(detail: string) {
  const limit = 1024;
  if (detail.length <= limit) {
    return detail;
  }
  return `${detail.slice(0, limit)}...`;
}

function raceNativeCall<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | "native_call_timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("native_call_timeout"), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isValidPolicyEntry(entry: NativePolicyEntry) {
  return (
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.length > 0 &&
    entry.classifications.length > 0 &&
    entry.classifications.every((classification) =>
      ["internal", "exposable", "denied", "unknown"].includes(classification)
    )
  );
}
