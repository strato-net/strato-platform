const legacyEscapes: Record<string, string> = {
  "8212": "\u2014",
  "8216": "\u2018",
  "8217": "\u2019",
  "8220": "\u201C",
  "8221": "\u201D",
};

export const normalizeLegacyEscapes = (value: string): string =>
  value.replace(/\\(8212|8216|8217|8220|8221)/g, (_, code) => legacyEscapes[code] || code);

export const sanitizeJsonLikeStringArgs = (input: string): string => {
  let output = "";
  let inString = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (char === '"') {
      if (!inString) {
        inString = true;
        output += char;
        continue;
      }

      const nextToken = input.slice(index + 1).match(/\S/)?.[0];
      if (nextToken === "," || nextToken === "]" || nextToken === "}" || nextToken === ":") {
        inString = false;
        output += char;
      } else {
        output += '\\"';
      }
      continue;
    }

    if (inString && char === "\\") {
      const next = input[index + 1] || "";
      const isJsonEscape = /["\\/bfnrt]/.test(next) || (next === "u" && /^[0-9a-fA-F]{4}/.test(input.slice(index + 2, index + 6)));
      if (isJsonEscape) {
        output += char + next;
        index++;
      } else {
        output += "\\\\";
      }
      continue;
    }

    output += char;
  }

  return output;
};
