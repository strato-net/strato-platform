import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';

export class ContractsProvider implements vscode.TreeDataProvider<ContractTreeItem> {
  constructor() {}

  getTreeItem(element: ContractTreeItem): ContractTreeItem {
    return element;
  }

  async getChildren(element?: ContractTreeItem): Promise<ContractTreeItem[]> {
    if (element) {
      switch(element.itemType) {
        case 'node': {
          const chains = await this.getChains(element.nodeId);
          const compareFn = (a,b) => {
            if (!a.id) return -1;
            if (!b.id) return 1;
            return a.info.label.localeCompare(b.info.label)
          }
          const items = chains.sort(compareFn).map((e) => new ContractTreeItem('chainId', {chainId: e.id, label: `⛓ ${e.info.label}`, description: `${e.id ? e.id : ''}`, tooltip: `${e.info.label}${e.id ? `:${e.id}` : ''}`}, element.nodeId, vscode.TreeItemCollapsibleState.Collapsed))
          return Promise.resolve(items);
        }
        case 'chainId': {
          const chainId = element.item.chainId;
          const contracts = await this.getContracts(chainId, element.nodeId);
          const compareFn = (a,b) => a[0].localeCompare(b[0])
          const items = Object.entries(contracts).sort(compareFn).map((e) => new ContractTreeItem('contractName', {contractName: e[0], chainId, contracts: e[1], label: `${e[0]}`, tooltip: `${e[0]}`}, element.nodeId, vscode.TreeItemCollapsibleState.Collapsed));
          return Promise.resolve(items);
        }
        case 'contractName': {
          const { contractName, chainId, contracts } = element.item
          const items = contracts.map((e) => new ContractTreeItem('address', {contractName, contractAddress: e.address, chainId, label: `📝 ${e.address}`, tooltip: `${e.address}`}, element.nodeId, vscode.TreeItemCollapsibleState.Collapsed));
          return Promise.resolve(items);
        }
        case 'address': {
          const { contractName, chainId, contractAddress } = element.item
          const state = await this.getContractState(element.item.contractName, element.item.contractAddress, element.item.chainId, element.nodeId);
          const items = Object.entries(state).map((e) => new ContractTreeItem('stateItem', {label: `${e[0]}`, description: `${e[1]}`, tooltip: `${e[0]}: ${e[1]}`, contractName, chainId, contractAddress, variableName: e[0]}, element.nodeId, vscode.TreeItemCollapsibleState.None));
          return Promise.resolve(items);
        }
      }
      return Promise.resolve([]);
    } else {
      const items = this.getNodes();
      return Promise.resolve(items);
    }
  }

  async getContracts(chainId, i) {
    const config = getConfig() || {}
    const options = { config, node: i || 0 };
    const appUser = await getApplicationUser()
    const query = {
      limit: 10000
    }
    const results = await rest.getContracts(appUser, chainId, {...options, query })
    return results
  }

  async getContractState(name, address, chainId, i) {
    const config = getConfig() || {}
    const options = { config, node: i || 0 };
    const appUser = await getApplicationUser()
    const contract = {
      name,
      address
    }
    const results = await rest.getState(appUser, contract, { ...options, chainIds:[chainId] })
    return results
  }

  async getChains(i) {
    const config = getConfig() || {}
    const options = { config, node: i || 0 };
    const appUser = await getApplicationUser()
    try {
    const results = await rest.getChains(appUser, [], options)
    const mainChain = {
      info: {
        label: 'Main Chain'
      }
    }
    return [mainChain, ...results]
    } catch (e) {
      console.log(e);
      return [];
    }
  }

  private async getNodes() {
    const config = getConfig() || {}
    const nodes = config.nodes || []
    const toDep = (dep: any): ContractTreeItem => {
      const prefixedLabel = `🖥️ ${dep.label ? dep.label : dep.url}`;
      return new ContractTreeItem( 'node',
        { ...dep, label: prefixedLabel, tooltip: dep.url, description: dep.label ? dep.url : undefined },
        dep.id, vscode.TreeItemCollapsibleState.Collapsed
      );
    };
    return nodes.map((a: any) => toDep(a));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    ContractTreeItem | undefined
  > = new vscode.EventEmitter<ContractTreeItem | undefined>();

  readonly onDidChangeTreeData: vscode.Event<ContractTreeItem | undefined> = this
    ._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}



class ContractTreeItem extends vscode.TreeItem {
  itemType: 'node' | 'chainId' | 'contractName' | 'address' | 'stateItem';
  item: any;
  nodeId: number;
  constructor(
    public readonly _itemType: 'node' | 'chainId' | 'contractName' | 'address' | 'stateItem',
    public readonly _item: any,
    public readonly _nodeId: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
  ) {
    super(_item.label, collapsibleState);
    this.itemType = _itemType;
    this.item = _item;
    this.nodeId = _nodeId;
    this.tooltip = this.item.tooltip;
    this.description = this.item.description;
    if ( _itemType === 'stateItem'
      && _item.label !== 'constructor'
      && _item.description.slice(0,8) === 'function'
      ) {
      this.contextValue = 'function';
    } else this.contextValue = _itemType;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'deployment.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'deployment.svg')
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
