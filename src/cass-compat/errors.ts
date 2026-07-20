export type CassCompatExitCode = 0 | 2 | 4 | 9;

export type CassCompatErrorKind =
  | "usage"
  | "not-found"
  | "empty-session"
  | "unknown";

export type CassCompatErrorEnvelope = {
  error: {
    code: Exclude<CassCompatExitCode, 0>;
    kind: CassCompatErrorKind;
    message: string;
    hint: string;
    retryable: boolean;
  };
};
