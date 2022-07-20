import * as vscode from 'vscode';
import * as path from 'path';

export class ProjectActionProvider implements vscode.TreeDataProvider<ProjectAction> {
  constructor() {}

  getTreeItem(element: ProjectAction): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ProjectAction): Thenable<ProjectAction[]> {
    if (element) {
      return Promise.resolve([])
    } else {
      return Promise.resolve([
        new ProjectAction('➕ Create Project', { title: 'Create Project', command: 'strato-vscode.createProject'}),
        new ProjectAction('🚀 Deploy Project', { title: 'Deploy Project', command: 'strato-vscode.deployProject'}),
        new ProjectAction('▶ Run Project', { title: 'Run Project', command: 'strato-vscode.runServer'}),
        new ProjectAction('🔨 Test Project', { title: 'Test Project', command: 'strato-vscode.testServer'})
      ])
    }
  }
}

class ProjectAction extends vscode.TreeItem {
  constructor(
    public readonly id: string,
    public readonly commandId: vscode.Command | undefined
  ) {
    super(id, vscode.TreeItemCollapsibleState.None);
    this.command = commandId;
    this.tooltip = id;
    this.description = '';
  }

  iconPath = {
    light: path.join(__filename, '..', '..', 'resources', 'light', 'deployment.svg'),
    dark: path.join(__filename, '..', '..', 'resources', 'dark', 'deployment.svg')
  };
}
