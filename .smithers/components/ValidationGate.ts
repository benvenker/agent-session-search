export type ReviewGateIssue = {
  severity: string;
  title: string;
  file?: string | null;
  description: string;
};

export type ValidationGateReviewRow = {
  approved?: boolean;
  feedback?: string;
  issues?: ReviewGateIssue[];
  disagreements?: string[];
  iteration?: unknown;
};

export type ValidationGateValidateRow = {
  allPassed?: boolean;
  failingSummary?: string | null;
  iteration?: unknown;
};

export type ValidationReviewGate = {
  done: boolean;
  feedback: string | null;
  iteration: number | null;
};

function rowIteration(row: { iteration?: unknown } | undefined) {
  const value = Number(row?.iteration ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function formatReviewFeedback(review: ValidationGateReviewRow) {
  const parts = [`REVIEW SYNTHESIS REJECTED:\n${review.feedback ?? ""}`];
  for (const issue of review.issues ?? []) {
    parts.push(
      `  [${issue.severity}] ${issue.title}: ${issue.description}${issue.file ? ` (${issue.file})` : ""}`
    );
  }
  const disagreements = review.disagreements ?? [];
  if (disagreements.length > 0) {
    parts.push(`DISAGREEMENTS:\n${disagreements.join("\n")}`);
  }
  return parts.join("\n");
}

export function buildValidationReviewGate({
  validate,
  review,
}: {
  validate?: ValidationGateValidateRow;
  review?: ValidationGateReviewRow;
}): ValidationReviewGate {
  if (!validate) {
    return { done: false, feedback: null, iteration: null };
  }

  const validateIteration = rowIteration(validate);
  const sameAttemptReview =
    review && rowIteration(review) === validateIteration ? review : undefined;
  const validationPassed = validate.allPassed !== false;
  const done = validationPassed && sameAttemptReview?.approved === true;
  const feedbackParts: string[] = [];

  if (!validationPassed && validate.failingSummary) {
    feedbackParts.push(`VALIDATION FAILED:\n${validate.failingSummary}`);
  }
  if (sameAttemptReview?.approved === false) {
    feedbackParts.push(formatReviewFeedback(sameAttemptReview));
  }

  return {
    done,
    feedback: feedbackParts.length > 0 ? feedbackParts.join("\n\n") : null,
    iteration: validateIteration,
  };
}
