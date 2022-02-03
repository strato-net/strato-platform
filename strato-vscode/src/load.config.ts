import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export default function getConfig(): any {
    const cfgPath: string = vscode.workspace.getConfiguration().get('strato-vscode.configPath') || '';
    const serverName: string = vscode.workspace.getConfiguration().get('strato-vscode.serverName') || 'localhost';
    const filename: string = vscode.workspace.getConfiguration().get('strato-vscode.configFile') || 'config.yaml';
    const folders = vscode.workspace.workspaceFolders || []
    if (folders.length === 0) {
      return {}
    }
    const currentFolder = folders[0]
		const folder = currentFolder.uri.path;
    // eslint-disable-next-line import/no-mutable-exports
    const pathName = 
      process.env.SERVER
        ? path.join(folder, cfgPath, serverName, filename)
        : cfgPath
        ? path.join(folder, cfgPath, filename)
        : path.join(folder, filename);
    const config = yaml.load(fs.readFileSync(path.resolve(pathName).replace('C:\\c:\\','C:\\').replace('C:\\C:\\','C:\\'), 'utf-8'));
    return config
}