export type QuerySynonyms = Record<string, string[]>;

export function rewriteQueryPatterns(
  query: string,
  options: {
    maxPatterns?: number;
    synonyms?: QuerySynonyms;
  } = {},
) {
  const patterns = [
    ...extractCommands(query),
    ...extractQuotedPhrases(query),
    ...extractErrorFragments(query),
    ...extractPackageNames(query),
    ...extractFilePaths(query),
    ...extractIds(query),
    ...extractSymbolVariants(query),
    ...expandSynonyms(query, options.synonyms ?? {}),
  ];
  const expandedPatterns = uniquePatterns(patterns);
  const fallbackPatterns = expandedPatterns.length > 0 ? expandedPatterns : [query];
  return options.maxPatterns === undefined ? fallbackPatterns : fallbackPatterns.slice(0, options.maxPatterns);
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
  return [...query.matchAll(/\b(?:[A-Z][A-Za-z]+Error|Error):\s+[^.;\n]+/g)].map((match) => match[0].trim());
}

function extractPackageNames(query: string) {
  return [...query.matchAll(/(?:^|\s)(@[\w.-]+\/[\w.-]+)(?=$|\s|[),.;:])/g)].map((match) => match[1]);
}

function extractFilePaths(query: string) {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/^[`"']+|[`"'),.;:]+$/g, ""))
    .filter((token) => token.includes("/") && /^(?:~|\.{1,2}|\/)?[\w.-]+(?:\/[\w.-]+)+$/.test(token));
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
  return [...query.matchAll(/#[0-9]+\b|\bbd-[a-z0-9]+\b|\b(?:PR|pr)-?[0-9]+\b/g)].map((match) => match[0]);
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

function queryContainsTerm(query: string, term: string) {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escapedTerm}(?=$|\\W)`, "i").test(query);
}
