import { createHash } from "node:crypto";
import type {
  GroupCandidatesFollowupInput,
  PatternPlan,
  SourceName,
} from "./types.js";

export type GroupCandidatesFingerprintPayload = Omit<
  GroupCandidatesFollowupInput,
  "fingerprint"
>;

export type GroupCandidatesPlanFingerprintSource = {
  name: SourceName;
  root: string;
  include?: string[];
  status: "ok" | "missing" | "failed";
};

export function groupCandidatesFingerprint(
  followup: GroupCandidatesFingerprintPayload | GroupCandidatesFollowupInput
): string {
  return `gcf1:${digest(groupCandidatesFingerprintPayload(followup))}`;
}

export function groupCandidatesPlanFingerprint(
  patternPlans: PatternPlan[],
  sources: GroupCandidatesPlanFingerprintSource[]
): string {
  return `gcp1:${digest({
    patterns: patternPlans.map((plan) => ({
      id: plan.id,
      query: plan.query,
      pattern: plan.pattern,
      provenance: plan.provenance,
      initialGroup: plan.initialGroup,
    })),
    sources: sources.map((source) => ({
      name: source.name,
      root: source.root,
      ...(source.include ? { include: source.include } : {}),
      status: source.status,
    })),
  })}`;
}

export function groupCandidatesFingerprintIsValid(
  followup: GroupCandidatesFollowupInput
): boolean {
  return followup.fingerprint === groupCandidatesFingerprint(followup);
}

export function groupCandidatesFingerprintPayload(
  followup: GroupCandidatesFingerprintPayload | GroupCandidatesFollowupInput
): GroupCandidatesFingerprintPayload {
  const { fingerprint: _fingerprint, ...payload } =
    followup as GroupCandidatesFollowupInput;
  return payload;
}

export function stringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(value)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  if (value === undefined) {
    return "null";
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(stableJson(value))
    .digest("hex")
    .slice(0, 16);
}
