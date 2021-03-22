// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DeploysProvider } from './deploys';
import { NodesProvider } from './nodes';
import { ProjectActionProvider } from './project';
import { activateMockDebug } from './activateMockDebug';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "strato-vscode" is now active!');
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.createProject', async () => {
		const mProjectName = await vscode.window.showInputBox({
			placeHolder: "Enter the directory in which the STRATO project will reside",
			value: "new-strato-project"
		});
		const projectName = mProjectName || ''
		const workspaceFolderUri = vscode.Uri.parse(projectName);
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.createProjectCommand') || '';
		const cmdStr = cmd.replace(/\$1/g, workspaceFolderUri.path);
		let terminal
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			terminal = terminals[0]
		} else {
			terminal = vscode.window.createTerminal()
		}
		terminal.show()
		terminal.sendText(cmdStr, true)
		const numFolders = (vscode.workspace.workspaceFolders || []).length;
        vscode.workspace.updateWorkspaceFolders(0, numFolders, { uri: workspaceFolderUri });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.deployProject', () => {
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.deployProjectCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
		    terminal.show()
		    terminal.sendText(cmd, true)
		}
        vscode.commands.executeCommand('deployments.refreshEntry');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runServer', () => {
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runServerCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
		    terminal.show()
		    terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testServer', () => {
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testServerCommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
		    terminal.show()
		    terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.runUI', () => {
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.runUICommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
		    terminal.show()
		    terminal.sendText(cmd, true)
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('strato-vscode.testUI', () => {
        const cmd: string = vscode.workspace.getConfiguration().get('strato-vscode.testUICommand') || '';
		const terminals = vscode.window.terminals;
		if (terminals && terminals.length) {
			const terminal = terminals[0]
		    terminal.show()
		    terminal.sendText(cmd, true)
		}
	}));

	const deploymentsProvider = new DeploysProvider();
    vscode.window.registerTreeDataProvider('deployments', deploymentsProvider);
    vscode.commands.registerCommand('deployments.refreshEntry', () =>
      deploymentsProvider.refresh()
    );
	vscode.window.registerTreeDataProvider(
		'deployments',
		deploymentsProvider
	)
	const nodesProvider = new NodesProvider();
    vscode.window.registerTreeDataProvider('nodes', nodesProvider);
    vscode.commands.registerCommand('nodes.refreshEntry', () =>
      nodesProvider.refresh()
    );
	vscode.window.registerTreeDataProvider(
		'nodes',
		nodesProvider
	)
	vscode.window.registerTreeDataProvider(
		'project-management',
		new ProjectActionProvider()
	)
    activateMockDebug(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
