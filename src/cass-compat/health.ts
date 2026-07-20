import { packageVersion } from "../package-info.js";
import { completeJsonSuccess, type CassCompatCompletion } from "./output.js";

export function cassCompatShimIdentity() {
  return {
    name: "agent-session-search-cass-shim",
    version: packageVersion(),
    engine: "fff-live",
  } as const;
}

export function completeCassCompatHealth(stderr = ""): CassCompatCompletion {
  return completeJsonSuccess(
    {
      status: "ok",
      healthy: true,
      explanation: "no index; sessions searched live",
      shim: cassCompatShimIdentity(),
    },
    stderr
  );
}
