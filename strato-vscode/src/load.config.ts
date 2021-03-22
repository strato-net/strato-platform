import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as vscode from 'vscode';

export default function getConfig(): any {
    const cfgPath: string = vscode.workspace.getConfiguration().get('strato-vscode.configPath') || '';
    const serverName: string = vscode.workspace.getConfiguration().get('strato-vscode.serverName') || 'localhost';
    const folders = vscode.workspace.workspaceFolders || []
    if (folders.length === 0) {
      return {}
    }
    const currentFolder = folders[0]
		const folder = currentFolder.uri.path;
    // eslint-disable-next-line import/no-mutable-exports
    const pathName = 
      process.env.SERVER
        ? `${folder}/${cfgPath}/${serverName}.config.yaml`
        : `${folder}${cfgPath ? `/${cfgPath}` : ''}/config.yaml`
    const config = yaml.load(fs.readFileSync(pathName, 'utf-8'));
    return config
}