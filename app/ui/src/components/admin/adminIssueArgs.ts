import { jsonTextOutsideStrings, parseJsonBigIntStrict } from '../../utils/numberUtils.ts';

// Quote characters a document substitutes for plain ASCII ones. The parser reports
// these rather than rewriting them: which plain quote a curly one stood for is a
// guess, and guessing is what used to change an array's contents and its length.
// Escaped rather than literal so they stay visible to a reviewer.
const SUBSTITUTED_QUOTES = /[\u201C\u201D\u2018\u2019\u201A\u201B\uFF02\uFF07]/;

// A parse failure arrives either as a SyntaxError from JSON.parse or, from
// json-bigint, as a plain object carrying name/message/at, so `.message` has to be
// read off the value itself. `at` is the offending character's offset when present.
const jsonErrorDetail = (error: unknown): string => {
  const { message, at } = (error ?? {}) as { message?: unknown; at?: unknown };
  if (typeof message !== 'string') return String(error);
  return typeof at === 'number' ? `${message} at character ${at}` : message;
};

export type AdminIssueArgType = {
  tag?: string;
  entry?: AdminIssueArgType;
};

export type AdminIssueFormArg = {
  value: string;
};

export const validateAdminIssueArg = (
  type: AdminIssueArgType,
  value: unknown,
): [boolean, unknown?] => {
  const tag = type.tag?.toLocaleLowerCase() || 'string';
  if (tag === 'int') {
    // Keep bigints as strings so large values survive without precision loss.
    if (typeof value === 'bigint') return [true, value.toString()];
    const val = typeof value === 'number' ? String(value) : String(value ?? '').trim();
    const valNum = Number(val);

    if (val === '' || isNaN(valNum) || !Number.isInteger(valNum)) {
      return [false, `Invalid integer value: ${String(value)}`];
    }
    return [true, val];
  }
  if (tag === 'bool') {
    if (typeof value === 'boolean') return [true, value];
    const b = String(value ?? '').trim().toLocaleLowerCase();
    if (b === 'true' || b === 'false') {
      return [true, b === 'true'];
    }
    return [false, `Invalid boolean value: ${String(value)}`];
  }
  if (tag === 'address') {
    if (typeof value !== 'string') {
      return [false, `Invalid address: ${String(value)}`];
    }
    const lowercase = value.toLocaleLowerCase();
    const isHex = /^(0x)?[0-9A-Fa-f]{1,40}$/.test(lowercase);
    if (!isHex) {
      return [false, `Invalid address: ${value}`];
    }
    return lowercase.substring(0, 2) !== '0x'
      ? [true, `0x${lowercase}`]
      : [true, lowercase];
  }
  if (tag === 'array') {
    try {
      // Nested arrays are already parsed by the enclosing array's recursion.
      let arr: unknown;
      if (Array.isArray(value)) {
        arr = value;
      } else {
        const text = String(value ?? '');
        try {
          arr = parseJsonBigIntStrict(text);
        } catch (parseError) {
          const detail = jsonErrorDetail(parseError);
          // Substituted quotes are the usual cause when JSON pasted from a document
          // fails to parse, and only the author knows which quote was meant, so say
          // so rather than picking one. Only quotes standing where syntax belongs
          // earn the hint: a curly apostrophe inside a value is correct there, and
          // telling someone to replace it would corrupt the value.
          return [
            false,
            SUBSTITUTED_QUOTES.test(jsonTextOutsideStrings(text))
              ? `Invalid JSON: ${detail}. Replace curly quotes with plain " characters.`
              : `Invalid JSON: ${detail}`,
          ];
        }
      }
      if (!Array.isArray(arr)) {
        return [false, 'Invalid array'];
      }
      const validated: unknown[] = [];
      for (const entry of arr) {
        const [entrySuccess, nextValue] = validateAdminIssueArg(type.entry || {}, entry);
        if (!entrySuccess) return [false, nextValue];
        validated.push(nextValue);
      }
      return [true, validated];
    } catch (error) {
      return [
        false,
        `Array validation error: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
  }
  // Structs and other composite types arrive already parsed, and there is (currently)
  // no field metadata here to validate them against, so pass them through as-is.
  // Non-composite non-strings (null, numbers, booleans) are not valid string args.
  if (value !== null && typeof value === 'object') return [true, value];
  if (typeof value !== 'string') return [false, `Invalid string value: ${String(value)}`];
  // Not trimmed: surrounding whitespace is part of the value, and dropping it
  // changed both what got stored and the issueId a later vote has to hash to. This
  // branch also carries bytes/decimal/account/contract, which the backend trims
  // itself, and enum/variadic, which it does not — so a padded enum name now fails
  // on chain instead of being silently corrected, which is the trade this whole
  // branch makes. The function name is trimmed at submit, being an identifier
  // rather than data.
  return [true, value];
};

export const buildValidatedAdminIssueArgs = (
  args: AdminIssueFormArg[],
  functionArgs: Array<[string, { type?: AdminIssueArgType }]> | undefined,
): unknown[] =>
  args.map((arg, index) => {
    const [success, value] = validateAdminIssueArg(
      functionArgs?.[index]?.[1]?.type || {},
      arg.value,
    );
    if (!success) {
      throw new Error(typeof value === 'string' ? value : 'Invalid argument');
    }
    return value;
  });
