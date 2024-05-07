import * as vscode from 'vscode';
import * as path from 'path';
import { rest } from 'blockapps-rest';
import getConfig from './load.config';
import { getApplicationUser } from './auth';

export class NodesProvider implements vscode.TreeDataProvider<Node> {
  constructor() {}
  // generate tooltip+ label generator

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  createNode(label: any, target: any, collapse: vscode.TreeItemCollapsibleState){
    let childData = this.getNodesFromParent(target);
    return new Node(label, collapse, childData)
  }

  toChild = (key: string, value: any): Node => {
    return new Node({label: `${key}`, tooltip: `${value}`, description: `${value}`}, vscode.TreeItemCollapsibleState.None);
  }

  getNodesFromParent(target: any) {
    let childrenArray: any = [];
    let keys = Object.keys(target)
    for(let i in keys) {
      let currentChild: any = target[keys[i]];
      let currentConvertedChild = this.toChild(keys[i], currentChild);
      childrenArray.push(currentConvertedChild);
    }
    return childrenArray;
  }
  
  getMenu(element?: any) {
    let menus: any = [];
    let elements = Object.keys(element)
    for(let i in elements) {
      if(typeof element[elements[i]] == "object") {
        menus.push(new Node(
          { label: `${elements[i]}` }, 
          vscode.TreeItemCollapsibleState.Expanded, 
          this.getMenu(element[elements[i]])
        ));
      } else {
        menus.push(new Node({
          label: `${elements[i]}`, 
          tooltip: `${element[elements[i]]}`, 
          description: `${element[elements[i]]}`
        }, vscode.TreeItemCollapsibleState.None))
      }
    }

    return menus;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) {

      if(element.collapsibleState != 2) {
        const node = await this.getNodeVersion(element);

        if (!node) return []

        let newResults = this.getMenu(node);
        return newResults;

      } else {
        return element.children ? element.children : [];
      }
    } else {
      return this.getNodes();
    }
  }

  async getNodeVersion(node): Promise<any> {
    const config = getConfig() || {}
    const options = { config };
    try {
      const user = await getApplicationUser(node.id)
      const res = await rest.getStatus(user, { ...options, node: node.id })
      return res;
    } catch(e) {
      return undefined
    }
  }

  async getNodesInternal(): Promise<any[]> {
    const config = getConfig() || {}
    const nodes = config.nodes || []
    // console.debug(`NodesProvider/getNodesInternal/nodes: ${nodes}`)
    const filledNodes = await Promise.all(nodes.map(async (element) => {
      try {
        const node = await this.getNodeVersion(element);
        return { ...element, ...node };
      } catch {
        return element
      }
    }));

    return filledNodes
  }

  /**
   * Given the path to package.json, read all its deployments and devDeployments.
   */
  private async getNodes(): Promise<Node[]> {
    const nodes = await this.getNodesInternal();

    const toDep = (dep: any): Node => {
      console.debug(dep)
      const connected = dep && dep.healthData
      const prefix = connected ? (dep.healthStatus === 'HEALTHY' ? '✅ ' : '⚠️ ') : '❌ ';
      const prefixedLabel = `${prefix}${dep.label ? dep.label : dep.url}`;
      return new Node(
        { 
          ...dep, 
          label: prefixedLabel, 
          tooltip: dep.url, 
          description: dep.label ? dep.url : undefined 
        },
        connected ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        undefined,
        'node'
      );
    };
    return nodes.map((a: any) => toDep(a));
  }

  private _onDidChangeTreeData: vscode.EventEmitter<Node | undefined> = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Node | undefined> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}



class Node extends vscode.TreeItem {
  _node: any;
  id: any;
  constructor(
    public readonly node: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public children?: Node[],
    public nodeType?: string
  ) {
    super(node.label, collapsibleState);
    this._node = node;
    this.id = node.id;
    this.tooltip = node.tooltip;
    this.description = node.description;
    this.contextValue = nodeType;
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
