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
        new ProjectAction('➕ Import Project', { title: 'Import Project', command: 'strato-vscode.importProject'}),
        new ProjectAction('🏗️ Build Project', {title: 'Build Project', command: 'strato-vscode.buildProject'} ),
        new ProjectAction('🚀 Deploy Project', { title: 'Deploy Project', command: 'strato-vscode.deployProject'}),
        new ProjectAction('💿 Run Server', { title: 'Run Server', command: 'strato-vscode.runServer'}),
        new ProjectAction('📀 Run UI', { title: 'Run UI', command: 'strato-vscode.runUI'}),
        new ProjectAction('🔨 Test Server', { title: 'Run Server Tests', command: 'strato-vscode.testServer'}),
        new ProjectAction('🔨 Test UI', { title: 'Run UI Tests', command: 'strato-vscode.testUI'})
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
