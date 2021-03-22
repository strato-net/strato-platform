/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { StratoDebugSession } from './stratoDebug';

export function activateStratoDebug(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.commands.registerCommand('extension.strato-debug.debugEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'strato',
					name: 'Debug SolidVM',
					request: 'launch',
					program: targetResource.fsPath
				});
			}
		}),
	);

	// register a configuration provider for 'strato' debug type
	const provider = new StratoConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('strato', provider));

	// register a dynamic configuration provider for 'strato' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('strato', {
		provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
			return [
				{
					name: "Dynamic Launch",
					request: "launch",
					type: "strato",
				}
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

	const factory = new InlineDebugAdapterFactory();
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('strato', factory));
	if ('dispose' in factory) {
		context.subscriptions.push(factory);
	}

	// override VS Code's default implementation of the debug hover
	/*
	vscode.languages.registerEvaluatableExpressionProvider('markdown', {
		provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.EvaluatableExpression> {
			const wordRange = document.getWordRangeAtPosition(position);
			return wordRange ? new vscode.EvaluatableExpression(wordRange) : undefined;
		}
	});
	*/
}

class StratoConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'solidity') {
				config.type = 'strato';
				config.name = 'Launch';
				config.request = 'launch';
			}
		}

		return config;
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new StratoDebugSession());
	}
}
