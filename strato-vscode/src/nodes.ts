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

  createNode(label: any, target: any){
    console.log('TARGET', target);
    
    let childData = this.getNodesFromParent(target[1]);
    return new Node(label, vscode.TreeItemCollapsibleState.Expanded, childData)
  }

  toChild = (key: string, value: any): Node => {
    return new Node({label: key, tooltip: `${JSON.stringify(value)}`, description: `${JSON.stringify(value)}`}, vscode.TreeItemCollapsibleState.None);
  }

  getNodesFromParent(target: any) {
    let childrenArray: any = [];
    for(let i in target) {
      let currentChild: any = target[i];
      // console.log('HERE IS CURRENT KEY FOR CHILD', i);
      
      // console.log('HERE IS CURRENT CHILD', currentChild);
      let currentConvertedChild = this.toChild(i, currentChild);
      childrenArray.push(currentConvertedChild);
    }
    console.log('HERE IS ARRAY', childrenArray);
    return childrenArray;
  }
  getMenu(element?: any) {
    console.log('INSIDE GET MENU', element);
    let menus: any = [];
    for(let i in element) {
      if(element[i][0] != 'version' && Object.keys(element[i][1]).length != 0) {
        menus.push(this.createNode({label: `${element[i][0]}`, tooltip: `${JSON.stringify(element[i][1])}`, description: `${JSON.stringify(element[i][1])}`}, element[i]));
      } else {
        menus.push(new Node({label: `${element[i][0]}`, tooltip: `${JSON.stringify(element[i][1])}`, description: `${JSON.stringify(element[i][1])}`}, vscode.TreeItemCollapsibleState.None))
      }
    }
    
    return menus;
    
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element) {

      console.log('Here is element', element);
      
      if(element.collapsibleState != 2) {
        const node = await this.getNodeVersion(element);
        console.log('Here is NODE', node);
        
        if (!node) return []
        const entries = Object.entries(node);
        console.log('ENTRIES', entries);
        let newResults = this.getMenu(entries);
        console.log('NEWRESULTS', newResults);
        return newResults;
        
        // const items = entries.map((e) => new Node({label: `${e[0]}`, tooltip: `${JSON.stringify(e[1])}`, description: `${JSON.stringify(e[1])}`}, vscode.TreeItemCollapsibleState.None));
        // console.log('HERE', items);
        // return items;
      } else {
        return element.children;
      }
    } else {
      return this.getNodes();
    }
  }

  async getNodeVersion(node): Promise<any> {
    console.log('INSIDE GETNODEVERSION');
    
    const config = getConfig() || {}
    const options = { config };
    try {
      const results:any[] = []
      const user = await getApplicationUser(node.id)
      const res = await rest.getStatus(user, { ...options, node: node.id })   
      console.log('HERE IS RES', res);
      
      return res;
    } catch(e) {
      console.log(e)
      return undefined
    }
  }

  async getNodesInternal(): Promise<any[]> {
    const config = getConfig() || {}
    const nodes = config.nodes || []
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
      const connected = dep && dep.healthInfo
      const prefix = connected ? (connected.isHealthy ? '✅ ' : '❌ ') : '📴 ';
      const prefixedLabel = `${prefix}${dep.label}`;
      return new Node(
        { ...dep, label: prefixedLabel, tooltip: dep.url, description: dep.url },
        connected ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        undefined,
        'node'
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
