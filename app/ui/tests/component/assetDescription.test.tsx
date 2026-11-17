// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Token } from "@/interface";
import fixture from "./fixtures/descriptions.json";

/**
 * These tests render the real asset page (pages/AssetDetail) and inspect the
 * description it puts in the document. Only the page's data sources and its
 * unrelated chrome (sidebar, header, chart) are replaced.
 */

const ADDRESS = "93fb7295859b2d70199e0a4883b7c320cf874e6c";
const EMPTY: Token[] = [];

const state = vi.hoisted(() => ({ token: null as unknown }));
const getToken = vi.hoisted(() => vi.fn(async () => state.token));
const fetchTokens = vi.hoisted(() => vi.fn());

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ userAddress: null, isLoggedIn: false }),
}));
vi.mock("@/context/UserTokensContext", () => ({
  useUserTokens: () => ({
    activeTokens: EMPTY,
    inactiveTokens: EMPTY,
    allActiveTokens: EMPTY,
    loading: false,
    fetchTokens,
  }),
}));
vi.mock("@/context/TokenContext", () => ({
  useTokenContext: () => ({ getToken, earningAssets: EMPTY }),
}));
vi.mock("@/lib/axios", () => ({
  api: { get: vi.fn(async () => ({ data: { data: [] } })) },
}));
vi.mock("@/lib/bridgeLinks", () => ({
  normBridgeAddr: (a: string) => a.toLowerCase(),
  buildFundBuyPath: () => "/dashboard/fund",
  fetchBridgeBuyableAddresses: async () => new Set<string>(),
}));
vi.mock("@/components/dashboard/DashboardSidebar", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DashboardHeader", () => ({ default: () => null }));
vi.mock("@/components/charts/ConsolidatedPriceChart", () => ({ default: () => null }));

import AssetDetail from "@/pages/AssetDetail";

const FORMATTING_TAGS = new Set([
  "P", "BR", "SPAN", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI",
  "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "A",
]);
const FORMATTING_ATTRIBUTES = new Set(["href", "target", "rel", "style"]);
const LINK = /^(?:https?:\/\/|mailto:)/i;
const ALIGNMENT = /^text-align: (?:left|right|center|justify|start|end);?$/;

type DescriptionFields = { top?: unknown; nested?: unknown };

/** Same shape as the backend's GET /tokens/:address response. */
const tokenWith = ({ top, nested }: DescriptionFields): Token =>
  ({
    address: ADDRESS,
    _name: "Test Asset",
    _symbol: "TEST",
    _owner: "000000000000000000000000000000000000100c",
    _totalSupply: "0",
    customDecimals: 18,
    status: "2",
    _paused: false,
    images: [],
    attributes: [],
    balances: [],
    price: "0",
    marketCap: "0",
    description: top,
    ...(nested === undefined
      ? {}
      : { token: { _name: "Test Asset", _symbol: "TEST", description: nested } }),
  }) as Token;

/** Renders the real page for one token and returns its description element. */
const renderDescription = async (fields: DescriptionFields): Promise<HTMLElement> => {
  state.token = tokenWith(fields);
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/dashboard/deposits/${ADDRESS}`]}>
        <Routes>
          <Route path="/dashboard/deposits/:id" element={<AssetDetail />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
  return screen.findByTestId("asset-description");
};

/** Everything left in the description is formatting the app styles itself. */
const expectAppFormattingOnly = (root: HTMLElement) => {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    expect(FORMATTING_TAGS.has(element.tagName), `element <${element.tagName.toLowerCase()}>`).toBe(true);
    for (const attribute of Array.from(element.attributes)) {
      expect(FORMATTING_ATTRIBUTES.has(attribute.name), `attribute ${attribute.name}`).toBe(true);
    }
    const href = element.getAttribute("href");
    if (href !== null) {
      expect(element.tagName).toBe("A");
      expect(href).toMatch(LINK);
      expect(element.getAttribute("target")).toBe("_blank");
      expect(element.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
    const style = element.getAttribute("style");
    if (style !== null) expect(style).toMatch(ALIGNMENT);
  }
};

afterEach(() => {
  cleanup();
  getToken.mockClear();
});

type Entry = { address: string; name: string; description: string };

/** What a description must still look like once it is in the page. */
const expectContentPreserved = (root: HTMLElement, original: string) => {
  const expected = new DOMParser().parseFromString(`<body>${original}</body>`, "text/html").body;
  expect(root.textContent).toBe(expected.textContent);
  const tags = (node: Element) => Array.from(node.querySelectorAll("*")).map((e) => e.tagName);
  expect(tags(root)).toEqual(tags(expected));
  const links = (node: Element) => Array.from(node.querySelectorAll("a")).map((a) => a.getAttribute("href"));
  expect(links(root)).toEqual(links(expected));
  const aligned = (node: Element) =>
    Array.from(node.querySelectorAll<HTMLElement>("[style]"))
      .map((e) => e.style.textAlign)
      .filter(Boolean);
  expect(aligned(root)).toEqual(aligned(expected));
  expectAppFormattingOnly(root);
};

describe("asset description on the asset page", () => {
  it.each((fixture as Entry[]).map((entry) => [entry.name || entry.address, entry] as const))(
    "keeps text, structure, links and alignment: %s",
    async (_name, entry) => {
      const root = await renderDescription({ top: entry.description });
      expectContentPreserved(root, entry.description);
    },
  );

  it("drops pasted fonts, sizes and colours so the text follows the theme", async () => {
    const root = await renderDescription({
      top: '<p><span style="color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 11pt">text</span></p>',
    });
    expect(root.innerHTML).toBe("<p><span>text</span></p>");
  });

  it("keeps alignment from a style that also sets other properties", async () => {
    const root = await renderDescription({ top: '<h3 style="text-align: center; color: rgb(34, 34, 34)">Title</h3>' });
    expect(root.innerHTML).toBe('<h3 style="text-align: center">Title</h3>');
  });

  it("opens links in a new tab", async () => {
    const root = await renderDescription({
      top: '<a href="https://www.goldback.com/page?a=1&amp;b=2" target="_self" class="link">Goldback</a>',
    });
    expect(root.innerHTML).toBe(
      '<a href="https://www.goldback.com/page?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">Goldback</a>',
    );
  });

  it("keeps the text of markup it does not style", async () => {
    const root = await renderDescription({ top: '<div class="box"><font face="Arial">Vaulted</font> gold</div>' });
    expect(root.innerHTML).toBe("Vaulted gold");
  });

  it.each([
    ["a number", 12345],
    ["an object", { text: "description" }],
    ["null", null],
  ])("renders nothing for a description that is %s", async (_name, value) => {
    const root = await renderDescription({ top: value });
    expect(root.innerHTML).toBe("");
  });
});

describe("asset description on the asset page: both description fields", () => {
  const pasted = '<p style="font-size: 12px"><span style="color: rgb(0, 0, 0)">kept text</span></p>';
  const formatted = "<p><span>kept text</span></p>";

  it("formats the top-level description", async () => {
    const root = await renderDescription({ top: pasted });
    expect(root.innerHTML).toBe(formatted);
  });

  it("formats the nested token description", async () => {
    const root = await renderDescription({ nested: pasted });
    expect(root.innerHTML).toBe(formatted);
  });

  it("formats the nested description when it takes precedence", async () => {
    const root = await renderDescription({ top: "<p>other</p>", nested: pasted });
    expect(root.innerHTML).toBe(formatted);
  });

  it("formats the top-level description when the nested one is empty", async () => {
    const root = await renderDescription({ top: pasted, nested: "" });
    expect(root.innerHTML).toBe(formatted);
  });
});

describe("asset description on the asset page: a supplied corpus", () => {
  // Optional: point DESCRIPTION_CORPUS at a JSON export of every live
  // description ([{address, name, description}]) to check the whole set.
  const corpusPath = process.env.DESCRIPTION_CORPUS;
  it.skipIf(!corpusPath)("keeps the content of every description in the corpus", async () => {
    const corpus = JSON.parse(readFileSync(corpusPath as string, "utf8")) as Entry[];
    expect(corpus.length).toBeGreaterThan(0);
    for (const entry of corpus) {
      const root = await renderDescription({ top: entry.description });
      try {
        expectContentPreserved(root, entry.description);
      } catch (error) {
        throw new Error(`description of ${entry.address} (${entry.name}) changed: ${(error as Error).message}`);
      }
      cleanup();
    }
    console.info(`corpus checked: ${corpus.length} descriptions`);
  }, 600_000);
});
