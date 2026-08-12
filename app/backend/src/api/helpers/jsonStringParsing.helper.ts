const legacyEscapes: Record<string, string> = {
  "8212": "\u2014",
  "8216": "\u2018",
  "8217": "\u2019",
  "8220": "\u201C",
  "8221": "\u201D",
};

export const normalizeLegacyEscapes = (value: string): string =>
  value.replace(/\\(8212|8216|8217|8220|8221)/g, (_, code) => legacyEscapes[code] || code);
