import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';

export class ContractsProvider implements vscode.TreeDataProvider<ContractTreeItem> {
  constructor() {}

  getTreeItem(element: ContractTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ContractTreeItem): Promise<ContractTreeItem[]> {
    if (element) {
      switch(element.itemType) {
        case 'chainId': {
          const chainId = element.item.chainId;
          const contracts = await this.getContracts(chainId);
          const items = Object.entries(contracts).map((e) => new ContractTreeItem('contractName', {contractName: e[0], chainId, contracts: e[1], label: `${e[0]}`, tooltip: `${e[0]}`}, vscode.TreeItemCollapsibleState.Collapsed));
          return Promise.resolve(items);
        }
        case 'contractName': {
          const { contractName, chainId, contracts } = element.item
          const items = contracts.map((e) => new ContractTreeItem('address', {contractName, contractAddress: e.address, chainId, label: `${e.address}`, tooltip: `${e.address}`}, vscode.TreeItemCollapsibleState.Collapsed))
          return Promise.resolve(items);
        }
        case 'address': {
          const state = await this.getContractState(element.item.contractName, element.item.contractAddress, element.item.chainId);
          const items = state.map((e) => new ContractTreeItem('stateItem', {label: `${e[0]}`, description: `${e[1]}`, tooltip: `${e[0]}: ${e[1]}`}, vscode.TreeItemCollapsibleState.None))
          return Promise.resolve(items);
        }
      }
      return Promise.resolve([]);
    } else {
      const chains = await this.getChains();
      const items = chains.map((e) => new ContractTreeItem('chainId', {label: `${e[1].label}`, description: `${e[0]}`, tooltip: `${e[0]}`}, vscode.TreeItemCollapsibleState.Collapsed))
      return Promise.resolve(items);
    }
  }

  async getContracts(chainId) {
    const config = getConfig() || {}
    const options = { config };
    const appUser = await getApplicationUser()
    const results = await rest.getContracts(appUser, chainId, options)
    return results
  }

  async getContractState(contractName, contractAddress, chainId) {
    const config = getConfig() || {}
    const options = { config };
    const appUser = await getApplicationUser()
    const contract = {
      contractName,
      contractAddress,
      chainId
    }
    const results = await rest.getState(appUser, contract, options)
    return results
  }

  async getChains() {
    const config = getConfig() || {}
    const options = { config };
    const appUser = await getApplicationUser()
    const results = await rest.getChains(appUser, [], options)
    return results
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
  itemType: 'chainId' | 'contractName' | 'address' | 'stateItem';
  item: any;
  constructor(
    public readonly _itemType: 'chainId' | 'contractName' | 'address' | 'stateItem',
    public readonly _item: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(_item.label, collapsibleState);
    this.itemType = _itemType;
    this.item = _item;
    this.tooltip = this.item.tooltip;
    this.description = this.item.description;
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
