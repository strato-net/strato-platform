// Bundle monaco locally (like the legacy SMD's webpack plugin) instead of letting
// @monaco-editor/react fetch it from the jsdelivr CDN — the /smd CSP blocks the CDN,
// which left the editor stuck on "Loading". loader.config({ monaco }) makes it use
// this bundled instance; the ?worker import wires up the editor web worker via Vite.
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// Minimal Solidity language so the editor highlights keywords (Solidity isn't built in).
if (!monaco.languages.getLanguages().some((l) => l.id === "sol")) {
  monaco.languages.register({ id: "sol" });
  monaco.languages.setMonarchTokensProvider("sol", {
    keywords: [
      "contract", "library", "interface", "function", "modifier", "event", "struct",
      "enum", "mapping", "address", "bool", "string", "var", "returns", "return",
      "if", "else", "for", "while", "do", "break", "continue", "throw", "import",
      "using", "pragma", "public", "private", "internal", "external", "pure", "view",
      "payable", "constant", "memory", "storage", "calldata", "emit", "new", "delete",
      "require", "assert", "revert", "constructor", "uint", "int", "bytes", "true", "false",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\b\d+\b/, "number"],
        [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
    },
  });
}

loader.config({ monaco });

export {};
