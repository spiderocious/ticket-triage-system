/** Deterministic text normalisation shared by the index and the query side. */
export const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","so","to","of","in","on","at","for","from","by","with","about","as","into","than","that","this","these","those","it","its","is","are","was","were","be","been","being","am","do","does","did","have","has","had","i","me","my","mine","we","our","you","your","he","she","they","them","their","can","could","will","would","should","may","might","must","not","no","yes","please","tell","help","need","want","also","just","still","very","there","here","what","which","who","whom","how","why","when","where","any","some","all","more","most","other","such","only","own","same","too","s","t","hi","hello","thanks","thank",
]);

export function stem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ations")) t = `${t.slice(0, -6)}ate`;
  else if (t.length > 4 && t.endsWith("ation")) t = `${t.slice(0, -5)}ate`;
  if (t.length > 4 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 3 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("es") && !t.endsWith("ses")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.endsWith("al") && t.length > 6) t = t.slice(0, -2); // withdrawal -> withdraw
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

export function normalizeText(text: string): string[] {
  return tokenize(text).map(stem);
}
