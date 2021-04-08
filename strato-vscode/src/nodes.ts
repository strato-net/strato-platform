import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import getConfig from './load.config';
import { getApplicationUser } from './auth';

export class NodesProvider implements vscode.TreeDataProvider<Node> {
  constructor() {}

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Thenable<Node[]> {
    if (element) {
        return this.getNodeVersion(element).then((node) => {
          const entries = Object.entries(node)
          const items = entries.map((e) => new Node({label: `${e[0]}`, tooltip: `${e[1]}`, description: `${e[1]}`}, vscode.TreeItemCollapsibleState.None))
          return items;
        });
    } else {
      return this.getNodes();
    }
  }

  async getNodeVersion(node): Promise<any> {
    const config = getConfig() || {}
    const options = { config };
    try {
      const results:any[] = []
      const user = await getApplicationUser()
      const  { monostrato } = await rest.getVersion(user, options)
      return monostrato;
    } catch(e) {
      console.log(e)
      return undefined
    }
  }

  async getNodesInternal(): Promise<any[]> {
    const config = getConfig() || {}
    const nodes = config.nodes || []
    return nodes
  }

  /**
   * Given the path to package.json, read all its deployments and devDeployments.
   */
  private async getNodes(): Promise<Node[]> {
    const nodes = await this.getNodesInternal();

    const toDep = (dep: any): Node => {
      return new Node(
        {tooltip: dep.url, description: dep.url, ...dep},
        vscode.TreeItemCollapsibleState.Collapsed
      );
    };

    return nodes.map((a: any) => toDep(a));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<
    Node | undefined
  > = new vscode.EventEmitter<Node | undefined>();

  readonly onDidChangeTreeData: vscode.Event<Node | undefined> = this
    ._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}



class Node extends vscode.TreeItem {
  _node: any;
  constructor(
    public readonly node: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(node.label, collapsibleState);
    this._node = node;
    this.tooltip = node.tooltip;
    this.description = node.description;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'node.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'node.svg')
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
