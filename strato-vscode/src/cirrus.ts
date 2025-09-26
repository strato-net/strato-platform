import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import * as parser from '@solidity-parser/parser';
import type { ContractDefinition, EventDefinition } from '@solidity-parser/parser/dist/src/ast-types';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';
import getOptions from './load.options';

type CirrusViewMode = 'remote' | 'local';

interface ContractEventsItem {
  label: string;
  description: string;
  tooltip: string;
  events: EventTreeItemData[];
  filePaths: string[];
}

interface EventTreeItemData {
  label: string;
  description: string;
  tooltip: string;
  signature: string;
  definedIn: string;
  filePath: string;
}

interface ParsedContractInfo {
  name: string;
  filePaths: string[];
  events: ParsedEventInfo[];
  bases: string[];
}

interface ParsedEventInfo {
  name: string;
  signature: string;
  definedIn: string;
  filePath: string;
}

export class CirrusProvider implements vscode.TreeDataProvider<CirrusItem> {
  _queryString: string;
  private _mode: CirrusViewMode;
  private _localContracts: ContractEventsItem[];
  constructor() {
    this._queryString = '';
    this._mode = 'remote';
    this._localContracts = [];
  }

  getTreeItem(element: CirrusItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CirrusItem): Thenable<CirrusItem[]> {
    if (element) {
      if (element.itemType === 'contract') {
        const events: EventTreeItemData[] = element._item.events || [];
        const items = events.map((event) =>
          new CirrusItem(
            {
              label: event.label,
              description: event.description,
              tooltip: event.tooltip,
              signature: event.signature,
              definedIn: event.definedIn,
              filePath: event.filePath
            },
            vscode.TreeItemCollapsibleState.None,
            'event'
          )
        );
        return Promise.resolve(items);
      }

      if (element.itemType === 'remote') {
        const entries = Object.entries(element._item);
        const items = entries.map((e) =>
          new CirrusItem(
            {
              label: `${e[0]}`,
              description: `${e[1]}`,
              tooltip: `${e[1]}`
            },
            vscode.TreeItemCollapsibleState.None,
            'detail'
          )
        );
        return Promise.resolve(items);
      }

      return Promise.resolve([]);
    }

    if (this._mode === 'local') {
      return this.getLocalContracts();
    }

    return this.queryCirrus();
  }

  async callCirrus(name, query): Promise<string[]> {
    const options = getOptions() 
    const appUser = await getApplicationUser()
    const results = await rest.search(appUser, { name }, { ...options, query })
    return results
  }

  /**
   * Given the path to a designated config.yaml, read all its deployments information
   */
  private async queryCirrus(): Promise<CirrusItem[]> {
    const [name, queryString] = this._queryString.split('?')
    if (name && name !== '') {
      const queryClauses = (queryString || '').split('&')
      const query = queryClauses.reduce((obj, clause) => {
        const [key, value] = clause.split('=')
        return { ...obj, [key]: value }
      }, {})
      const items = await this.callCirrus(name, query);
      const acct = (_dep) => `${_dep.address}${_dep.chainId ? `:${_dep.chainId}` : ''}`;
      const toDep = (_dep: any): CirrusItem => {
        const dep = { ..._dep, label: acct(_dep), tooltip: acct(_dep), description: '' }
        return new CirrusItem(
          dep,
          vscode.TreeItemCollapsibleState.Collapsed,
          'remote'
        );
      };

      return (items || []).map((a: any) => toDep(a));
    } else {
      return [];
    }
  }

  private async getLocalContracts(): Promise<CirrusItem[]> {
    const items = this._localContracts;
    return items.map((contract) =>
      new CirrusItem(
        {
          label: contract.label,
          description: contract.description,
          tooltip: contract.tooltip,
          events: contract.events,
          filePaths: contract.filePaths
        },
        vscode.TreeItemCollapsibleState.Collapsed,
        'contract'
      )
    );
  }

  async showLocalEvents(): Promise<void> {
    this._mode = 'local';
    this._localContracts = await this.collectLocalContractEvents();
    this.refresh();
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    CirrusItem | undefined
  > = new vscode.EventEmitter<CirrusItem | undefined>();

  readonly onDidChangeTreeData: vscode.Event<CirrusItem | undefined> = this
    ._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  query(queryString: string): void {
    this._queryString = queryString;
    this._mode = 'remote';
    this._onDidChangeTreeData.fire(undefined);
  }

  private async collectLocalContractEvents(): Promise<ContractEventsItem[]> {
    const configPath = vscode.workspace.getConfiguration().get('strato-vscode.configPath', '') as string;
    const config = getConfig() || {};

    if (!configPath || configPath === '') {
      vscode.window.showWarningMessage('Configure a STRATO config file to scan local contract events.');
      return [];
    }

    if (!config.contractsPath) {
      vscode.window.showWarningMessage('No contractsPath found in the selected configuration file.');
      return [];
    }

    const resolvedContractsPath = path.isAbsolute(config.contractsPath)
      ? config.contractsPath
      : path.resolve(path.dirname(configPath), config.contractsPath);

    let stats;
    try {
      stats = await fsPromises.stat(resolvedContractsPath);
    } catch (err) {
      vscode.window.showWarningMessage(`Contracts directory not found at ${resolvedContractsPath}.`);
      return [];
    }

    if (!stats.isDirectory()) {
      vscode.window.showWarningMessage(`Contracts path ${resolvedContractsPath} is not a directory.`);
      return [];
    }

    const solidityFiles = await this.collectSolidityFiles(resolvedContractsPath);
    if (solidityFiles.length === 0) {
      vscode.window.showInformationMessage('No Solidity files found in the configured contracts directory.');
      return [];
    }

    const contractMap = await this.parseSolidityContracts(solidityFiles);

    const referencedBases = new Set<string>();
    for (const contract of contractMap.values()) {
      for (const base of contract.bases) {
        if (contractMap.has(base)) {
          referencedBases.add(base);
        }
      }
    }

    const leaves = Array.from(contractMap.values()).filter((contract) => !referencedBases.has(contract.name));

    const contractItems: ContractEventsItem[] = [];
    for (const contract of leaves) {
      const events = this.collectEventsForContract(contract, contractMap, new Set<string>());
      const uniqueEvents = this.dedupeEvents(events);
      if (uniqueEvents.length === 0) continue;

      const relativePaths = contract.filePaths.map((filePath) => this.toRelativePath(filePath));
      contractItems.push({
        label: contract.name,
        description: relativePaths.join(', '),
        tooltip: [contract.name, ...relativePaths].join('\n'),
        filePaths: contract.filePaths,
        events: uniqueEvents.map((event) => ({
          label: event.name,
          description: event.definedIn === contract.name ? 'defined here' : `inherited from ${event.definedIn}`,
          tooltip: `${event.signature}\n${this.toRelativePath(event.filePath)}`,
          signature: event.signature,
          definedIn: event.definedIn,
          filePath: event.filePath
        }))
      });
    }

    return contractItems.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async collectSolidityFiles(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const resolved = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.collectSolidityFiles(resolved);
        files.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.sol')) {
        files.push(resolved);
      }
    }

    return files;
  }

  private async parseSolidityContracts(files: string[]): Promise<Map<string, ParsedContractInfo>> {
    const contractMap = new Map<string, ParsedContractInfo>();

    for (const filePath of files) {
      let source: string;
      try {
        source = await fsPromises.readFile(filePath, 'utf8');
      } catch (err) {
        continue;
      }

      let ast;
      try {
        ast = parser.parse(source, { loc: true, range: true, tolerant: true });
      } catch (err) {
        vscode.window.showWarningMessage(`Failed to parse Solidity file: ${filePath}`);
        continue;
      }

      parser.visit(ast, {
        ContractDefinition: (node: ContractDefinition) => {
          const events = (node.subNodes || [])
            .filter((subNode) => subNode.type === 'EventDefinition')
            .map((subNode) => this.toEventInfo(subNode as EventDefinition, node, filePath, source));

          const bases = (node.baseContracts || []).map((base) =>
            base.baseName.type === 'UserDefinedTypeName'
              ? base.baseName.namePath
              : (base.baseName as any).name || ''
          ).filter((name) => name && typeof name === 'string');

          const existing = contractMap.get(node.name);
          if (existing) {
            existing.events.push(...events);
            existing.filePaths = Array.from(new Set([...existing.filePaths, filePath]));
            existing.bases = Array.from(new Set([...existing.bases, ...bases]));
          } else {
            contractMap.set(node.name, {
              name: node.name,
              filePaths: [filePath],
              events: events,
              bases: bases
            });
          }
        }
      });
    }

    return contractMap;
  }

  private toEventInfo(event: EventDefinition, contract: ContractDefinition, filePath: string, source: string): ParsedEventInfo {
    const signature = event.range ? source.slice(event.range[0], event.range[1]).trim() : `event ${event.name}`;
    return {
      name: event.name,
      signature,
      definedIn: contract.name,
      filePath
    };
  }

  private collectEventsForContract(
    contract: ParsedContractInfo,
    contractMap: Map<string, ParsedContractInfo>,
    visited: Set<string>
  ): ParsedEventInfo[] {
    if (visited.has(contract.name)) {
      return [];
    }

    visited.add(contract.name);
    let events: ParsedEventInfo[] = [...contract.events];

    for (const baseName of contract.bases) {
      const base = contractMap.get(baseName);
      if (base) {
        events = events.concat(this.collectEventsForContract(base, contractMap, visited));
      }
    }

    return events;
  }

  private dedupeEvents(events: ParsedEventInfo[]): ParsedEventInfo[] {
    const unique = new Map<string, ParsedEventInfo>();
    events.forEach((event) => {
      const key = `${event.definedIn}::${event.name}::${event.signature}`;
      if (!unique.has(key)) {
        unique.set(key, event);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private toRelativePath(filePath: string): string {
    try {
      return vscode.workspace.asRelativePath(filePath, false);
    } catch (err) {
      return filePath;
    }
  }
}

class CirrusItem extends vscode.TreeItem {
  _item: any;
  itemType: 'remote' | 'contract' | 'event' | 'detail';
  constructor(
    public readonly item: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly _itemType: 'remote' | 'contract' | 'event' | 'detail' = 'remote'
  ) {
    super(item.label, collapsibleState);
    this.tooltip = item.tooltip;
    this.description = item.description;
    this.itemType = _itemType;
    const { tooltip, description, label, ...rest } = item;
    this._item = rest;
    this.contextValue = _itemType;
  }

  iconPath = {
    light: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'light', 'deployment.svg')),
    dark: vscode.Uri.file(path.join(__filename, '..', '..', 'resources', 'dark', 'deployment.svg'))
  };
}



  // private pathExists(p: string): boolean {
  //   try {
  //     fs.accessSync(p);
  //   } catch (err) {
  //     return false;
  //   }
  //   return true;
  // }