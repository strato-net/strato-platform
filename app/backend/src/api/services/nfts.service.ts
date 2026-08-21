import { cirrus, strato } from "../../utils/appApiHelper";
import { isMissingTableError, emptyOnMissingTable } from "../../utils/cirrusErrors";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { NFT_SOURCES, NFTSource } from "../../config/nftSources";

const { NFT } = constants;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface OwnedRow {
  address: string; // collection contract address
  tokenId: string;
  owner: string;
}

// A burned token keeps its _owners row with the zero address as the value; such rows
// must be excluded from listings (and treated as "not found" for a single item).
const isZeroAddress = (address?: string): boolean =>
  !address || /^0+$/.test(address.replace(/^0x/, ""));

// Cirrus stores addresses canonically (lowercase, no 0x); align inbound addresses to it.
const normalizeAddr = (address: string): string => address.toLowerCase().replace(/^0x/, "");

// The `_owners` value column (a mapping's address value) is JSON-typed in Cirrus, so a
// PostgREST equality filter must pass a valid JSON string literal — `eq."<addr>"`, not
// `eq.<addr>` (the latter fails with 22P02 "invalid input syntax for type json").
const jsonEq = (value: string): string => `eq.\"${value}\"`;

// String mapping values (e.g. tokenURI) come back JSON-encoded from the jsonb value column
// (an empty string reads as `"\"\""`, a real URI as `"\"ipfs://…\""`). Decode to the bare
// string. Address values (owner/approved) render bare and don't need this.
const decodeCirrusString = (raw: unknown): string => {
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
};

// Shared NFTCollection shape (name/symbol/…), mapped from the raw Cirrus columns so every
// endpoint returns the same shape rather than leaking `_name`/`_symbol`/`_owner`.
const mapCollection = (row: any) => ({
  address: row?.address,
  name: row?._name ?? "",
  symbol: row?._symbol ?? "",
  owner: row?._owner,
  status: row?.status,
  description: row?.description,
  images: row?.images,
  paused: row?._paused,
});

const fetchCollectionsMeta = async (
  accessToken: string,
  source: NFTSource,
  collectionAddresses: string[]
) => {
  if (collectionAddresses.length === 0) return [];
  const res = await cirrus
    .get(accessToken, `/${source.cirrusPrefix}`, {
      params: {
        select: source.collectionSelect.join(","),
        address: `in.(${collectionAddresses.join(",")})`,
      },
    })
    .catch(emptyOnMissingTable);
  return (res.data as any[]) || [];
};

// Map of `${collection}-${tokenId}` → decoded tokenURI, scoped by the given address/key
// filters so callers fetch only the rows they need (never the whole collection).
const fetchTokenURIMap = async (
  accessToken: string,
  source: NFTSource,
  addressFilter: string,
  keyFilter?: string
): Promise<Map<string, string>> => {
  if (!source.hasTokenURIs) return new Map();
  const params: Record<string, string> = {
    select: "address,tokenId:key,uri:value",
    address: addressFilter,
  };
  if (keyFilter) params.key = keyFilter;
  const res = await cirrus
    .get(accessToken, `/${source.cirrusPrefix}-_tokenURIs`, { params })
    .catch(emptyOnMissingTable);
  return new Map(
    ((res.data as any[]) || []).map((u) => [
      `${u.address}-${String(u.tokenId)}`,
      decodeCirrusString(u.uri),
    ])
  );
};

/** All NFTs owned by a user, aggregated across every registered source. */
export const getOwnedNFTs = async (accessToken: string, userAddress: string) => {
  const owner = normalizeAddr(userAddress);
  const perSource = await Promise.all(
    NFT_SOURCES.map(async (source) => {
      try {
        const { data } = await cirrus.get(accessToken, `/${source.cirrusPrefix}-_owners`, {
          params: {
            select: "address,tokenId:key,owner:value",
            value: jsonEq(owner),
          },
        });
        const ownedRows = ((data as OwnedRow[]) || []).filter(
          // Burned ids keep a row with the zero-address owner filtered out by the value filter,
          // but guard against tokenId 0 artifacts anyway.
          (row) => row.tokenId !== undefined && row.tokenId !== null
        );
        if (ownedRows.length === 0) return [];

        const collectionAddresses = [...new Set(ownedRows.map((row) => row.address))];
        const ownedTokenIds = [...new Set(ownedRows.map((row) => String(row.tokenId)))];
        const [collections, uriMap] = await Promise.all([
          fetchCollectionsMeta(accessToken, source, collectionAddresses),
          // Scope the URI fetch to the owned (collection, id) space rather than every URI in
          // every collection the user touches.
          fetchTokenURIMap(
            accessToken,
            source,
            `in.(${collectionAddresses.join(",")})`,
            `in.(${ownedTokenIds.join(",")})`
          ),
        ]);

        const collectionByAddress = new Map(collections.map((c: any) => [c.address, c]));

        return ownedRows.map((row) => {
          const meta = collectionByAddress.get(row.address);
          return {
            kind: source.kind,
            collection: { ...mapCollection(meta), address: row.address },
            tokenId: String(row.tokenId),
            tokenURI: uriMap.get(`${row.address}-${String(row.tokenId)}`) ?? "",
          };
        });
      } catch (e) {
        // A source whose Cirrus tables don't exist yet (no contract of this type ever created
        // — true on every network until the first mint) yields nothing rather than rejecting
        // the whole aggregate. A real outage (non-missing-table) propagates as a retryable error.
        if (isMissingTableError(e)) return [];
        throw e;
      }
    })
  );
  return perSource.flat();
};

/** List NFT collections (the "collection" source only — bare ERC721 sources are not browsable collections). */
export const getCollections = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const source = NFT_SOURCES.find((s) => s.kind === "collection")!;
  const params = Object.fromEntries(
    Object.entries(rawParams).filter(([_, v]) => v !== undefined)
  ) as Record<string, string>;
  if (!params.select) {
    params.select = source.collectionSelect.join(",");
  }
  const res = await cirrus.get(accessToken, `/${NFT}`, { params }).catch(emptyOnMissingTable);
  return ((res.data as any[]) || []).map(mapCollection);
};

/** Collection detail plus a paginated list of its items. */
export const getCollection = async (
  accessToken: string,
  collectionAddressRaw: string,
  { limit = "50", offset = "0" }: { limit?: string; offset?: string } = {}
) => {
  const collectionAddress = normalizeAddr(collectionAddressRaw);
  const source = NFT_SOURCES.find((s) => s.kind === "collection")!;
  const [collections, ownersResponse] = await Promise.all([
    fetchCollectionsMeta(accessToken, source, [collectionAddress]),
    cirrus
      .get(accessToken, `/${NFT}-_owners`, {
        params: {
          select: "tokenId:key,owner:value",
          address: `eq.${collectionAddress}`,
          order: "key.asc",
          limit,
          offset,
        },
      })
      .catch(emptyOnMissingTable), // missing _owners child table → no items; real outages propagate
  ]);

  const collectionRow = collections[0];
  if (!collectionRow) {
    const err = new Error("NFT collection not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const ownerRows = (((ownersResponse.data as any[]) || []))
    .filter((row) => !isZeroAddress(row.owner)); // exclude burned tokens (would 404 on click)

  // Fetch tokenURIs only for this page's tokenIds, not the whole collection.
  const pageTokenIds = ownerRows.map((row) => String(row.tokenId));
  const uriMap = pageTokenIds.length
    ? await fetchTokenURIMap(accessToken, source, `eq.${collectionAddress}`, `in.(${pageTokenIds.join(",")})`)
    : new Map<string, string>();

  const items = ownerRows.map((row) => ({
    tokenId: String(row.tokenId),
    owner: row.owner,
    tokenURI: uriMap.get(`${collectionAddress}-${String(row.tokenId)}`) ?? "",
  }));

  return { ...mapCollection(collectionRow), kind: source.kind, items };
};

/** Single item: owner, tokenURI, approved address. */
export const getNFTItem = async (
  accessToken: string,
  collectionAddressRaw: string,
  tokenId: string
) => {
  const collectionAddress = normalizeAddr(collectionAddressRaw);
  // Each source keeps its own Cirrus tables (e.g. a position NFT's owner row lives in
  // BlockApps-PositionManagerV3-_owners, not BlockApps-NFT-_owners), and `kind` picks the
  // UI's detail renderer — so resolve the source the same way the writes do.
  const source = await resolveSource(accessToken, collectionAddress);
  const [ownerResponse, approvalResponse, collections, uriMap] = await Promise.all([
    cirrus
      .get(accessToken, `/${source.cirrusPrefix}-_owners`, {
        params: { select: "owner:value", address: `eq.${collectionAddress}`, key: `eq.${tokenId}` },
      })
      .catch(emptyOnMissingTable),
    cirrus
      .get(accessToken, `/${source.cirrusPrefix}-_tokenApprovals`, {
        params: { select: "approved:value", address: `eq.${collectionAddress}`, key: `eq.${tokenId}` },
      })
      .catch(emptyOnMissingTable),
    fetchCollectionsMeta(accessToken, source, [collectionAddress]),
    // Single-row URI fetch (address + key), not a whole-collection scan.
    fetchTokenURIMap(accessToken, source, `eq.${collectionAddress}`, `eq.${tokenId}`),
  ]);

  const owner = (ownerResponse.data as any[])?.[0]?.owner;
  if (isZeroAddress(owner)) {
    const err = new Error("NFT not found");
    (err as any).statusCode = 404;
    throw err;
  }

  return {
    kind: source.kind,
    collection: { ...mapCollection(collections[0]), address: collectionAddress },
    tokenId,
    owner,
    approved: (approvalResponse.data as any[])?.[0]?.approved,
    tokenURI: uriMap.get(`${collectionAddress}-${String(tokenId)}`) ?? "",
  };
};

// ---------------------------------------------------------------------------
// Writes (executed as the calling wallet-auth user; on-chain permissions rule)
// ---------------------------------------------------------------------------

const executeNFTTx = async (
  accessToken: string,
  userAddress: string,
  txArgs: { contractName: string; contractAddress: string; method: string; args: Record<string, unknown> }
) => {
  const tx = await buildFunctionTx(txArgs, userAddress, accessToken);
  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
  return { status, hash };
};

// Collection creation and minting are performed on-chain directly (admin calls the
// NFTFactory / NFT contract), so this service exposes only transfer and burn as writes.

// STRATO transactions are dispatched by contract NAME, which differs per source ("NFT"
// for collections, "PositionManagerV3" for V3 position NFTs). Resolve the source whose
// collection-level table contains the address; unknown addresses fall back to the
// default "collection" source so the on-chain call (not this lookup) decides validity.
const resolveSource = async (accessToken: string, collectionAddress: string): Promise<NFTSource> => {
  for (const source of NFT_SOURCES) {
    const res = await cirrus
      .get(accessToken, `/${source.cirrusPrefix}`, {
        params: { address: `eq.${collectionAddress}`, select: "address", limit: "1" },
      })
      .catch(emptyOnMissingTable);
    if (((res.data as any[]) || []).length > 0) return source;
  }
  return NFT_SOURCES.find((s) => s.kind === "collection")!;
};

export const transferNFT = async (
  accessToken: string,
  userAddress: string,
  collectionAddress: string,
  body: { to: string; tokenId: string }
) => {
  const source = await resolveSource(accessToken, normalizeAddr(collectionAddress));
  return executeNFTTx(accessToken, userAddress, {
    contractName: source.contractName,
    contractAddress: normalizeAddr(collectionAddress),
    method: "transferFrom",
    args: { from: normalizeAddr(userAddress), to: normalizeAddr(body.to), tokenId: body.tokenId },
  });
};

export const burnNFT = async (
  accessToken: string,
  userAddress: string,
  collectionAddress: string,
  body: { tokenId: string }
) => {
  const source = await resolveSource(accessToken, normalizeAddr(collectionAddress));
  return executeNFTTx(accessToken, userAddress, {
    contractName: source.contractName,
    contractAddress: normalizeAddr(collectionAddress),
    method: "burn",
    args: { tokenId: body.tokenId },
  });
};
