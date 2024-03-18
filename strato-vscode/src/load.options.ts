import getConfig from './load.config';
import * as vscode from 'vscode';

export default function getOptions(): any {
    const config = getConfig() || {}
    const options = { config, node: vscode.workspace.getConfiguration().get('strato-vscode.activeNode') };
    return options
}