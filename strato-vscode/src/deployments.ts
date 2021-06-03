import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import { getApplicationUser } from './auth';
import getConfig from './load.config';

export class DeploymentsProvider implements vscode.TreeDataProvider<Deployment> {
  constructor() {}

  getTreeItem(element: Deployment): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Deployment): Thenable<Deployment[]> {
    if (element) {
        const entries = Object.entries(element._deployment)
        const items = entries.map((e) => new Deployment({label: `${e[0]}`, description: `${e[1]}`, tooltip: `${e[1]}`}, vscode.TreeItemCollapsibleState.None))
        return Promise.resolve(items);
    } else {
      return this.getDeployments();
    }
  }

  async getDeploymentsFromCirrus(name: string): Promise<string[]> {
    const config = getConfig() || {}
    const options = { config };
    const appUser = await getApplicationUser()
    const results = await rest.search(appUser, { name }, options)
    return results
  }

  /**
   * Given the path to package.json, read all its deployments and devDeployments.
   */
  private async getDeployments(): Promise<Deployment[]> {
    const config = getConfig() || {}
    const dappName = config.dappContractName || 'BeanstalkDapp'
    const deployments = await this.getDeploymentsFromCirrus(dappName);

    const toDep = (_dep: any): Deployment => {
      const dep = { ..._dep, label: _dep.address, tooltip: _dep.address, description: _dep.address }
      return new Deployment(
        dep,
        vscode.TreeItemCollapsibleState.Collapsed
      );
    };

    return deployments.map((a: any) => toDep(a));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Deployment | undefined
  > = new vscode.EventEmitter<Deployment | undefined>();

  readonly onDidChangeTreeData: vscode.Event<Deployment | undefined> = this
    ._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}



class Deployment extends vscode.TreeItem {
  _deployment: any;
  constructor(
    public readonly deployment: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(deployment.label, collapsibleState);
    this._deployment = deployment;
    this.tooltip = this._deployment.tooltip;
    this.description = this._deployment.description;
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
