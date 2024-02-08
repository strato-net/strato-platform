import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

export default function getConfig(): any {
    const filename: string = vscode.workspace.getConfiguration().get('strato-vscode.configPath') || '';
    // console.debug(`getConfig/configPath: ${filename}`)
    
    if (filename == '') return

    const config = yaml.load(fs.readFileSync(path.resolve(filename).replace('C:\\c:\\','C:\\').replace('C:\\C:\\','C:\\'), 'utf-8'));
    // console.debug(`getConfig/config/${filename}: ${config ? JSON.stringify(config) : JSON.stringify({})}`)
    
    return config
}