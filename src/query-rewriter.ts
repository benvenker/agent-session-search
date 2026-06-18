import type { MatchGroupId, PatternPlan, PatternProvenance } from "./types.js";

export type QuerySynonyms = Record<string, string[]>;

export function rewriteQueryPatterns(
  query: string,
  options: {
    maxPatterns?: number;
    synonyms?: QuerySynonyms;
  } = {}
) {
  const patterns = buildPatternPlanDrafts(query, options).filter(
    (plan) => plan.provenance !== "adjacent_terms"
  );
  const fallbackPatterns =
    patterns.length > 0 ? patterns.map((plan) => plan.pattern) : [query];
  return options.maxPatterns === undefined
    ? fallbackPatterns
    : fallbackPatterns.slice(0, options.maxPatterns);
}

export function planQueryPatterns(
  query: string,
  options: {
    maxPatterns?: number;
    synonyms?: QuerySynonyms;
  } = {}
): PatternPlan[] {
  const plans = buildPatternPlanDrafts(query, options).map((plan, index) => ({
    id: `p${index + 1}`,
    query,
    ...plan,
  }));
  const fallbackPlans =
    plans.length > 0
      ? plans
      : [
          {
            id: "p1",
            query,
            pattern: query,
            provenance: "full_phrase" as const,
            initialGroup: "exact_or_structured" as const,
          },
        ];
  return options.maxPatterns === undefined
    ? fallbackPlans
    : fallbackPlans.slice(0, options.maxPatterns);
}

type PatternPlanDraft = Omit<PatternPlan, "id" | "query">;

function buildPatternPlanDrafts(
  query: string,
  options: {
    synonyms?: QuerySynonyms;
  } = {}
) {
  const structuredPatterns = [
    ...patternsWithProvenance(extractCommands(query), "command"),
    ...patternsWithProvenance(extractQuotedPhrases(query), "quoted_phrase"),
    ...patternsWithProvenance(extractErrorFragments(query), "error_fragment"),
    ...patternsWithProvenance(extractPackageNames(query), "package_name"),
    ...patternsWithProvenance(extractFilePaths(query), "file_path"),
    ...patternsWithProvenance(
      extractPullRequestIds(query),
      "pull_request_reference"
    ),
    ...patternsWithProvenance(extractIds(query), "id"),
    ...patternsWithProvenance(extractSymbolVariants(query), "symbol_variant"),
    ...patternsWithGroup(
      expandSynonyms(query, options.synonyms ?? {}),
      "configured_synonym",
      "loose_fallback"
    ),
  ];
  const naturalTerms = extractNaturalLanguageTerms(query);
  const naturalTermsInOrder = extractNaturalLanguageTermsInOrder(query);
  const patterns = [
    ...structuredPatterns,
    ...(structuredPatterns.length === 0 && naturalTerms.length > 1
      ? [
          {
            pattern: query.trim(),
            provenance: "full_phrase" as const,
            initialGroup: "exact_or_structured" as const,
          },
          ...adjacentTermWindows(naturalTermsInOrder),
        ]
      : []),
    ...patternsWithGroup(naturalTerms, "natural_term", "distinctive_term"),
  ];
  return uniquePatternPlans(patterns);
}

function patternsWithProvenance(
  patterns: string[],
  provenance: PatternProvenance
): PatternPlanDraft[] {
  return patternsWithGroup(patterns, provenance, "exact_or_structured");
}

function patternsWithGroup(
  patterns: string[],
  provenance: PatternProvenance,
  initialGroup: MatchGroupId
): PatternPlanDraft[] {
  return patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => ({
      pattern,
      provenance,
      initialGroup,
    }));
}

function adjacentTermWindows(terms: string[]): PatternPlanDraft[] {
  if (terms.length < 3) {
    return [];
  }
  const windows: string[] = [];
  for (let index = 0; index < terms.length - 1; index += 1) {
    windows.push(`${terms[index]} ${terms[index + 1]}`);
  }
  return patternsWithGroup(
    windows,
    "adjacent_terms",
    "phrase_or_adjacent_terms"
  );
}

function extractCommands(query: string) {
  return [...query.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function extractQuotedPhrases(query: string) {
  return [...query.matchAll(/"([^"]+)"|'([^']+)'/g)]
    .map((match) => match[1] ?? match[2])
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function extractErrorFragments(query: string) {
  return [
    ...query.matchAll(/\b(?:[A-Z][A-Za-z]+Error|Error):\s+[^.;\n]+/g),
  ].map((match) => match[0].trim());
}

function extractPackageNames(query: string) {
  return [
    ...query.matchAll(/(?:^|\s)(@[\w.-]+\/[\w.-]+)(?=$|\s|[),.;:])/g),
  ].map((match) => match[1]);
}

function extractFilePaths(query: string) {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/^[`"']+|[`"'),.;:]+$/g, ""))
    .filter(
      (token) =>
        token.includes("/") &&
        /^(?:~|\.{1,2}|\/)?[\w.-]+(?:\/[\w.-]+)+$/.test(token)
    );
}

function extractSymbolVariants(query: string) {
  return [...query.matchAll(/\b[$A-Za-z_][\w$-]*\b/g)]
    .filter((match) => !isErrorClassName(match[0]))
    .flatMap((match) => symbolVariants(match[0]))
    .filter(Boolean);
}

function isErrorClassName(symbol: string) {
  return symbol === "Error" || /^[A-Z][A-Za-z]+Error$/.test(symbol);
}

function symbolVariants(symbol: string) {
  const words = splitSymbolWords(symbol);
  if (words.length < 2) {
    return [];
  }

  return [
    symbol,
    words.join("_"),
    words.join("-"),
    words[0] + words.slice(1).map(capitalize).join(""),
  ];
}

function splitSymbolWords(symbol: string) {
  if (symbol.includes("_") || symbol.includes("-")) {
    return symbol
      .split(/[_-]+/)
      .map((part) => part.toLowerCase())
      .filter(Boolean);
  }

  if (!/[a-z][A-Z]/.test(symbol)) {
    return [];
  }

  return symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function capitalize(word: string) {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function extractIds(query: string) {
  return [
    ...query.matchAll(/#[0-9]+\b|\bbd-[a-z0-9]+\b|\b(?:PR|pr)-?[0-9]+\b/g),
  ].map((match) => match[0]);
}

function extractPullRequestIds(query: string) {
  return [
    ...query.matchAll(/\b(?:PR|pr|pull request)\s*#?\s*([0-9]+)\b/g),
  ].flatMap((match) => {
    const number = match[1];
    return [
      `PR ${number}`,
      `PR #${number}`,
      `pull/${number}`,
      `pull request ${number}`,
      `#${number}`,
      number,
    ];
  });
}

function expandSynonyms(query: string, synonyms: QuerySynonyms) {
  const patterns: string[] = [];
  for (const [term, replacements] of Object.entries(synonyms)) {
    if (!queryContainsTerm(query, term)) {
      continue;
    }
    patterns.push(term, ...replacements);
  }
  return patterns;
}

function extractNaturalLanguageTerms(query: string) {
  return uniquePatterns(extractNaturalLanguageTermsInOrder(query)).sort(
    compareTermSpecificity
  );
}

function extractNaturalLanguageTermsInOrder(query: string) {
  const strippedQuery = stripStructuredFragments(query);
  return [...strippedQuery.matchAll(/\b[A-Za-z0-9][A-Za-z0-9_-]{2,}\b/g)]
    .map((match) => match[0])
    .filter((term) => !STOP_WORDS.has(term.toLowerCase()));
}

function stripStructuredFragments(query: string) {
  return [
    /`[^`]+`/g,
    /"[^"]+"|'[^']+'/g,
    /\b(?:[A-Z][A-Za-z]+Error|Error):\s+[^.;\n]+/g,
    /(?:^|\s)(@[\w.-]+\/[\w.-]+)(?=$|\s|[),.;:])/g,
    /(?:^|\s)(?:~|\.{1,2}|\/)?[\w.-]+(?:\/[\w.-]+)+(?=$|\s|[),.;:])/g,
    /#[0-9]+\b|\bbd-[a-z0-9]+\b|\b(?:PR|pr)-?[0-9]+\b/g,
    /\b(?:PR|pr|pull request)\s*#?\s*[0-9]+\b/g,
  ].reduce((value, pattern) => value.replace(pattern, " "), query);
}

function compareTermSpecificity(a: string, b: string) {
  return termSpecificityScore(b) - termSpecificityScore(a);
}

function termSpecificityScore(term: string) {
  return (
    term.length +
    (term.includes("-") || term.includes("_") ? 5 : 0) +
    (/\d/.test(term) ? 2 : 0)
  );
}

function uniquePatterns(patterns: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const pattern of patterns) {
    if (seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    unique.push(pattern);
  }
  return unique;
}

function uniquePatternPlans(patterns: PatternPlanDraft[]) {
  const seen = new Set<string>();
  const unique: PatternPlanDraft[] = [];
  for (const pattern of patterns) {
    if (seen.has(pattern.pattern)) {
      continue;
    }
    seen.add(pattern.pattern);
    unique.push(pattern);
  }
  return unique;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "around",
  "before",
  "bug",
  "check",
  "code",
  "did",
  "does",
  "find",
  "for",
  "from",
  "get",
  "how",
  "into",
  "issue",
  "near",
  "please",
  "problem",
  "search",
  "should",
  "that",
  "the",
  "this",
  "through",
  "use",
  "what",
  "when",
  "where",
  "with",
]);

function queryContainsTerm(query: string, term: string) {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escapedTerm}(?=$|\\W)`, "i").test(query);
}
