import fs from "fs";
import path from "path";
import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEvents } from "../services/events.service";

type ContractRecord = {
  name: string;
  bases: string[];
  events: Set<string>;
};

type ContractInfoResponse = {
  contracts: { name: string; events: string[] }[];
};

const CONTRACTS_ROOT = path.resolve(__dirname, "../../../../contracts");
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "artifacts",
  "build",
  "cache",
  "tests"
]);

let cachedContractInfo: ContractInfoResponse | null = null;
let cachedContractInfoError: Error | null = null;

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const collectSolidityFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...collectSolidityFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".sol")) {
      files.push(fullPath);
    }
  }

  return files;
};

const extractBlock = (source: string, startIndex: number): string => {
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex + 1, index);
      }
    }
  }

  return "";
};

const parseContracts = (source: string): ContractRecord[] => {
  const contracts: ContractRecord[] = [];
  const sanitizedSource = stripComments(source);
  const patterns: RegExp[] = [
    /\b(?:abstract\s+)?contract\s+([A-Za-z0-9_]+)\s*(?:is\s*([^\{;]+))?\s*\{/g,
    /\binterface\s+([A-Za-z0-9_]+)\s*(?:is\s*([^\{;]+))?\s*\{/g,
    /\blibrary\s+([A-Za-z0-9_]+)\s*(?:is\s*([^\{;]+))?\s*\{/g
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sanitizedSource)) !== null) {
      const contractName = match[1];
      const bases = (match[2] || "")
        .split(",")
        .map((base) => base.trim().split(" ")[0])
        .map((base) => base.split("(")[0].trim())
        .filter(Boolean);

      const bodyStart = sanitizedSource.indexOf("{", match.index);
      const body = bodyStart >= 0 ? extractBlock(sanitizedSource, bodyStart) : "";

      const eventRegex = /\bevent\s+([A-Za-z0-9_]+)\s*\(/g;
      const events = new Set<string>();
      let eventMatch: RegExpExecArray | null;

      while ((eventMatch = eventRegex.exec(body)) !== null) {
        events.add(eventMatch[1]);
      }

      contracts.push({
        name: contractName,
        bases,
        events
      });
    }
  }

  return contracts;
};

const buildContractGraph = (files: string[]): Map<string, ContractRecord> => {
  const contractMap = new Map<string, ContractRecord>();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const contract of parseContracts(source)) {
      const existing = contractMap.get(contract.name);

      if (existing) {
        for (const base of contract.bases) {
          if (!existing.bases.includes(base)) {
            existing.bases.push(base);
          }
        }
        for (const event of contract.events) {
          existing.events.add(event);
        }
      } else {
        contractMap.set(contract.name, {
          name: contract.name,
          bases: [...contract.bases],
          events: new Set(contract.events)
        });
      }
    }
  }

  return contractMap;
};

const collectInheritedEvents = (
  contract: ContractRecord,
  contractMap: Map<string, ContractRecord>,
  visited: Set<string>
): Set<string> => {
  if (visited.has(contract.name)) {
    return new Set();
  }

  visited.add(contract.name);

  const aggregated = new Set(contract.events);

  for (const baseName of contract.bases) {
    const baseContract = contractMap.get(baseName);
    if (!baseContract) {
      continue;
    }

    const inheritedEvents = collectInheritedEvents(
      baseContract,
      contractMap,
      new Set(visited)
    );

    for (const event of inheritedEvents) {
      aggregated.add(event);
    }
  }

  return aggregated;
};

const deriveLeafContracts = (contractMap: Map<string, ContractRecord>): ContractInfoResponse => {
  const referencedBases = new Set<string>();

  for (const contract of contractMap.values()) {
    for (const base of contract.bases) {
      if (contractMap.has(base)) {
        referencedBases.add(base);
      }
    }
  }

  const leafContracts = Array.from(contractMap.values()).filter(
    (contract) => !referencedBases.has(contract.name)
  );

  const contracts = leafContracts
    .map((contract) => {
      const events = collectInheritedEvents(contract, contractMap, new Set());
      return {
        name: contract.name,
        events: Array.from(events).sort()
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { contracts };
};

const loadContractInfo = (): ContractInfoResponse => {
  const solidityFiles = collectSolidityFiles(CONTRACTS_ROOT);
  const contractGraph = buildContractGraph(solidityFiles);
  return deriveLeafContracts(contractGraph);
};

const warmContractInfoCache = (): void => {
  try {
    cachedContractInfo = loadContractInfo();
    cachedContractInfoError = null;
  } catch (error) {
    cachedContractInfo = null;
    cachedContractInfoError = error as Error;
    console.error("Failed to load contract info:", error);
  }
};

const getCachedContractInfo = (forceRefresh = false): ContractInfoResponse => {
  if (forceRefresh || !cachedContractInfo) {
    warmContractInfoCache();
  }

  if (!cachedContractInfo) {
    throw (
      cachedContractInfoError ||
      new Error("Contract information is not available")
    );
  }

  return cachedContractInfo;
};

warmContractInfoCache();

class EventsController {
  static async getEvents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const events = await getEvents(accessToken, query as Record<string, string>);
      res.status(RestStatus.OK).json(events);
    } catch (error) {
      next(error);
    }
  }

  static async getContractInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const query = req.query as Record<string, string | string[] | undefined> | undefined;
      const refreshParam = query?.refresh;
      const forceRefresh = Array.isArray(refreshParam)
        ? refreshParam.includes("true")
        : refreshParam === "true";
      const contractInfo = getCachedContractInfo(forceRefresh);
      res.status(RestStatus.OK).json(contractInfo);
    } catch (error) {
      next(error);
    }
  }
}

export default EventsController; 