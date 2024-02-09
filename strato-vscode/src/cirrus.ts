import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';
import getOptions from './load.options';

export class CirrusProvider implements vscode.TreeDataProvider<CirrusItem> {
  _queryString: string;
  constructor() {
    this._queryString = '';
  }

  getTreeItem(element: CirrusItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CirrusItem): Thenable<CirrusItem[]> {
    if (element) {
        const entries = Object.entries(element._item)
        const items = entries.map((e) => new CirrusItem({label: `${e[0]}`, description: `${e[1]}`, tooltip: `${e[1]}`}, vscode.TreeItemCollapsibleState.None))
        return Promise.resolve(items);
    } else {
      return this.queryCirrus();
    }
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
          vscode.TreeItemCollapsibleState.Collapsed
        );
      };

      return (items || []).map((a: any) => toDep(a));
    } else {
      return [];
    }
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
    this._onDidChangeTreeData.fire(undefined);
  }
}

class CirrusItem extends vscode.TreeItem {
  _item: any;
  constructor(
    public readonly item: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(item.label, collapsibleState);
    this.tooltip = item.tooltip;
    this.description = item.description;
    delete item.tooltip
    delete item.description
    delete item.label
    this._item = item;
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