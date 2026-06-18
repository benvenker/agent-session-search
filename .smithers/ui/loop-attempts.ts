export type LoopAttemptSnapshot<TImplement, TValidate, TReview> = {
  iteration: number;
  implement: TImplement | null;
  validate: TValidate | null;
  review: TReview | null;
  evidence?: TReview[];
};

export function hasLoopAttemptOutput<TImplement, TValidate, TReview>(
  attempt: LoopAttemptSnapshot<TImplement, TValidate, TReview>
) {
  return (
    attempt.implement !== null ||
    attempt.validate !== null ||
    attempt.review !== null ||
    (attempt.evidence?.length ?? 0) > 0
  );
}

export function selectLatestLoopAttempt<TImplement, TValidate, TReview>(
  attempts: Array<LoopAttemptSnapshot<TImplement, TValidate, TReview>>
) {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (hasLoopAttemptOutput(attempts[index])) return attempts[index];
  }
  return attempts[0] ?? null;
}
