import { groupCandidatesFingerprint } from "../../src/followup.js";

export function groupCandidates(payload: any): any {
  const withPlanFingerprint = {
    planFingerprint: "gcp1:test",
    ...payload,
  };
  return {
    ...withPlanFingerprint,
    fingerprint: groupCandidatesFingerprint(withPlanFingerprint as any),
  };
}
