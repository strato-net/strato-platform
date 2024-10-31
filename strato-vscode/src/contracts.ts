import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';
import getOptions from './load.options';

export class ContractsProvider implements vscode.TreeDataProvider<ContractTreeItem> {
  private selectedContractAddresses: string[] = [];

  constructor(addresses: string[] = []) { addresses ? this.selectedContractAddresses = addresses : [] }

  getTreeItem(element: ContractTreeItem): ContractTreeItem {
    return element;
  }

  async getChildren(element?: ContractTreeItem): Promise<ContractTreeItem[]> {
    if (element) {
      switch(element.itemType) {
        case 'address': {
          const { contractName, chainId, contractAddress } = element.item
          try {
            const state = await this.getContractState(contractName, contractAddress, chainId, null);
            const items = Object.entries(state).map((e) => new ContractTreeItem('stateItem', {label: `${e[0]}`, description: `${e[1]}`, tooltip: `${e[1]}`, contractName, chainId, contractAddress, variableName: e[0]}, vscode.TreeItemCollapsibleState.None));
            return Promise.resolve(items);
          } catch (e) {
            return Promise.resolve([])
          }
        }
      }
      return Promise.resolve([]);
    } else {
      const items = await this.getSelectedContracts();
      return Promise.resolve(items);
    }
  }

  async searchContracts(address) {
    const options = getOptions()  || {}
    if (Object.keys(options.config).length === 0) return []
    const appUser = await getApplicationUser()
    try {
      const results = await rest.getContractsDetails(appUser, { address }, { ...options })
      return results
    } catch (e) {
      console.error(e)
      vscode.window.showErrorMessage(`${address} could not be found on ${options.config.nodes[options.node].url}. Please check that the current selected node is on the correct network.`)
      return []
    }
  }

  async getContractState(name, address, chainId, i) {
    const options = getOptions() || {}
    if (Object.keys(options.config).length === 0) return {}
    const appUser = await getApplicationUser()
    const contract = {
      name,
      address
    }
    const results = await rest.getState(appUser, contract, { ...options, chainIds:[chainId] })
    return results
  }

  // returns contract address list for extension to store in context
  async addContract(address): Promise<string[]> {
    this.selectedContractAddresses.push(address)
    this.selectedContractAddresses = Array.from(new Set(this.selectedContractAddresses))
    this.refresh()
    return this.selectedContractAddresses 
  }

  async removeContract(address) {
    this.selectedContractAddresses = this.selectedContractAddresses.filter((c) => c !== address)
    this.refresh()
    return this.selectedContractAddresses
  }

  async clearContracts() {
    this.selectedContractAddresses = []
    this.refresh()
  }

  private async getSelectedContracts() {
    const cfg = getConfig() || {}
    if (Object.keys(cfg).length === 0) return []

    const results = await Promise.all(this.selectedContractAddresses.map(async (c) => { return this.searchContracts(c) }))
    if (results.length === 0) return []
    return results.map((e, i) => new ContractTreeItem('address', {chainId: null, contractName: e._contractName, contractAddress: this.selectedContractAddresses[i], label: `${this.selectedContractAddresses[i]}`, tooltip: `${this.selectedContractAddresses[i]}`}, vscode.TreeItemCollapsibleState.Collapsed));
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
  constructor(
    public readonly _itemType: 'node' | 'chainId' | 'contractName' | 'address' | 'stateItem',
    public readonly _item: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
  ) {
    super(_item.label, collapsibleState);
    this.itemType = _itemType;
    this.item = _item;
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

