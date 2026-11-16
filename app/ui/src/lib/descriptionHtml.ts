import createDOMPurify from "dompurify";

/**
 * Asset descriptions are rich text, mostly pasted from other editors, so they
 * arrive with whatever markup the source carried. This keeps the structure a
 * description needs and drops the rest, so every description reads in the
 * app's own typography and theme.
 */

/** Formatting that descriptions use, plus the obvious siblings. */
const FORMATTING_TAGS = [
  "p", "br", "span",
  "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote",
  "a",
];

/** `style` survives only as far as `keptStyle` allows. */
const FORMATTING_ATTRIBUTES = ["href", "target", "rel", "style"];

/** Absolute web links and mail links. */
const LINK = /^(?:https?:\/\/|mailto:)/i;

const TEXT_ALIGN = new Set(["left", "right", "center", "justify", "start", "end"]);

/**
 * Keep `text-align` and nothing else. Pasted fonts, sizes and colours are
 * dropped so the description follows the app's typography in both themes.
 */
const keptStyle = (value: string): string => {
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const setting = declaration.slice(separator + 1).trim().toLowerCase();
    if (property === "text-align" && TEXT_ALIGN.has(setting)) {
      return `text-align: ${setting}`;
    }
  }
  return "";
};

type Formatter = ReturnType<typeof createDOMPurify>;

let formatter: Formatter | null = null;

/** A private instance, so these hooks never affect another DOMPurify user. */
const getFormatter = (): Formatter | null => {
  if (formatter) return formatter;
  if (typeof window === "undefined") return null;
  const instance = createDOMPurify(window);
  if (!instance.isSupported) return null;

  instance.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;
    const kept = keptStyle(data.attrValue);
    if (kept) data.attrValue = kept;
    else data.keepAttr = false;
  });

  instance.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    // Links in a description always open in a new tab.
    node.removeAttribute("target");
    node.removeAttribute("rel");
    if (node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  formatter = instance;
  return formatter;
};

/**
 * Returns the description as HTML limited to the formatting above. Returns an
 * empty string for anything that is not a string.
 */
export const formatDescriptionHtml = (html: unknown): string => {
  if (typeof html !== "string" || html === "") return "";
  const instance = getFormatter();
  if (!instance) return "";
  return instance.sanitize(html, {
    ALLOWED_TAGS: FORMATTING_TAGS,
    ALLOWED_ATTR: FORMATTING_ATTRIBUTES,
    ALLOWED_URI_REGEXP: LINK,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
};
