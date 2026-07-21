export function findLastValidJsonObject<T>(
  text: string,
  validate: (value: unknown) => T,
): T | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastValid: T | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    lastValid = parseCandidate(text.slice(start, index + 1), validate) ?? lastValid;
    start = -1;
  }
  return lastValid;
}

function parseCandidate<T>(
  candidate: string,
  validate: (value: unknown) => T,
): T | undefined {
  try {
    return validate(JSON.parse(candidate));
  } catch {
    return undefined;
  }
}
