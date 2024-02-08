/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, StoppedEvent, OutputEvent,
	ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent, InvalidatedEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { Subject } from 'await-notify';
import * as WebSocket from 'ws';
import { rest } from 'blockapps-rest';
import getConfig from './load.config';
import { getApplicationUser } from './auth';
import getOptions from './load.options';

function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * This interface describes the strato-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the strato-debug extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** run without debugging */
	noDebug?: boolean;
}

export class StratoDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static threadID = 1;

	private _variableHandles = new Handles<string>();

	private _configurationDone = new Subject();

	private _cancelationTokens = new Map<number, boolean>();
	private _isLongrunning = new Map<number, boolean>();

	private _reportProgress = false;
	private _progressId = 10000;
	private _cancelledProgressId: string | undefined = undefined;
	private _isProgressCancellable = true;

	private _showHex = false;
	private _useInvalidatedEvent = false;

	private _initialized = false;
    private _ws;
	private _status = undefined;
	private _user;
    private _options;
	private _sourceMap = {};

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("strato-debug.txt");
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	public async initialize() {
		this._initialized = true;
		const { user, options } = await this.getUserAndOptionsInternal()
		const { config } = options
		const { nodes } = config
		var token = user.token;
        var wsOptions = {
            headers: {
                "Authorization" : "Bearer " + token
            }
        };
		const activeNode: number = vscode.workspace.getConfiguration().get('strato.activeNode') || 0;
        this._ws = new WebSocket(`${nodes[activeNode].url}/vm-debug-ws/`, wsOptions);
        this._ws.on('message', (bytes) => {
           const message = JSON.parse(bytes.toString('utf-8'));
		   if(message.tag === 'WSOStatus') {
			   const { contents } = message;
			   const oldStatus = this._status;
               if (contents.tag === 'Running') {
				   this._status = undefined;
			   } else {
				   this._status = contents.contents;
			   }
			   if (!oldStatus) {
				   if (this._status) {
			           this.sendEvent(new StoppedEvent('pause', StratoDebugSession.threadID));
				   }
			   } else {
				   if (this._status) {
			           this.sendEvent(new StoppedEvent('step', StratoDebugSession.threadID));
				   }
			   }
		   }
           console.debug(`From websocket: ${message}`)
        });
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		if (args.supportsProgressReporting) {
			this._reportProgress = true;
		}
		if (args.supportsInvalidatedEvent) {
			this._useInvalidatedEvent = true;
		}

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code support data breakpoints
		response.body.supportsDataBreakpoints = true;

		// make VS Code support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code send cancelRequests
		response.body.supportsCancelRequest = true;

		// make VS Code send terminateRequests
		response.body.supportsTerminateRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = true;

		// the adapter defines two exceptions filters with support for conditions.
		response.body.supportsExceptionFilterOptions = true;
		response.body.exceptionBreakpointFilters = [
			{
				filter: 'namedException',
				label: "Named Exception",
				default: false,
				supportsCondition: true
			},
			{
				filter: 'otherExceptions',
				label: "Other Exceptions",
				default: true,
				supportsCondition: false
			}
		];

		// make VS Code send exceptionInfoRequests
		response.body.supportsExceptionInfoRequest = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	private async getUserAndOptionsInternal(): Promise<any> {
		if (!this._user) {
		    this._user = await getApplicationUser()
		}
		if (!this._options) {
            this._options = getOptions() || {};
		}
		return { user: this._user, options: this._options }
	}

	protected async getUserAndOptions(): Promise<any> {
		if (!this._initialized) {
			await this.initialize();
		}
        return this.getUserAndOptionsInternal();
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000);

		this.sendResponse(response);
	}

	protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) {

		const { user, options } = await this.getUserAndOptions();
		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000);

		try {
		// start the program in the runtime
        const res = await rest.debugPause(user, options)
		} catch(e) {
			console.log(e);
		}

	    this._ws.send(JSON.stringify({tag: "WSIStatus"}))
		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {

		const { user, options } = await this.getUserAndOptions();
		const path = args.source.path as string;
		const file = basename(path);
		const clientLines = args.lines || [];
		const bps = clientLines.map((l) => ({
			tag: "UnconditionalBP",
			contents: {
				name: file,
				line: l,
				column: 1
			}
		}))

		// clear all breakpoints for this file
		try {
        const res = await rest.debugClearBreakpointsPath(user, file, options)
		} catch(e) {
			console.log(e);
		}
		try {
		const res2 = await rest.debugPutBreakpoints(user, bps, options)
		} catch(e) {
			console.log(e);
		}

		// set and verify breakpoint locations
		const actualBreakpoints = clientLines.map(l => {
			const bp = new Breakpoint(true, this.convertDebuggerLineToClient(l)) as DebugProtocol.Breakpoint;
			bp.id= l;
			return bp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {

		if (args.source.path) {
			// const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
			response.body = {
				breakpoints: [] //bps.map(col => {
					// return {
					// 	line: args.line,
					// 	column: this.convertDebuggerColumnToClient(col)
					// };
				    //})
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<void> {

		let namedException: string | undefined = undefined;
		let otherExceptions = false;

		if (args.filterOptions) {
			for (const filterOption of args.filterOptions) {
				switch (filterOption.filterId) {
					case 'namedException':
						namedException = args.filterOptions[0].condition;
						break;
					case 'otherExceptions':
						otherExceptions = true;
						break;
				}
			}
		}

		if (args.filters) {
			if (args.filters.indexOf('otherExceptions') >= 0) {
				otherExceptions = true;
			}
		}

		this.sendResponse(response);
	}

	protected exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
		response.body = {
			exceptionId: 'Exception ID',
			description: 'This is a descriptive description of the exception.',
			breakMode: 'always',
			details: {
				message: 'Message contained in the exception.',
				typeName: 'Short type name of the exception object',
				stackTrace: 'stack frame 1\nstack frame 2',
			}
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(StratoDebugSession.threadID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {

	    // this._ws.send(JSON.stringify({tag: "WSIStackTrace"}))
		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;
		const { user, options } = await this.getUserAndOptions();
		// wait until configuration has finished (and configurationDoneRequest has been called)
		// await this._configurationDone.wait(1000);

        const stk = await rest.debugGetStackTrace(user, options)

		const stackFrames: StackFrame[] = []
		for (let i = 0; i < stk.length; i++) {
			const f = stk[i];
			const source = await this.createSourceFromFilename(f.name)
			const sf = new StackFrame(i, f.name, source, this.convertDebuggerLineToClient(f.line));
			sf.column = this.convertDebuggerColumnToClient(f.column);
			stackFrames.push(sf);
		}
		response.body = {
			stackFrames,
			//no totalFrames: 				// VS Code has to probe/guess. Should result in a max. of two requests
			totalFrames: stk.length			// stk.count is the correct size, should result in a max. of two requests
			//totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
			//totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		response.body = {
			scopes: [
			   new Scope("Local Variables", this._variableHandles.create("local"), false),
			   new Scope("State Variables", this._variableHandles.create("state"), true)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

		const variables: DebugProtocol.Variable[] = [];
		// wait until configuration has finished (and configurationDoneRequest has been called)
		// await this._configurationDone.wait(1000);
		const { user, options } = await this.getUserAndOptions();
        const ress = await rest.debugGetVariables(user, options)
		// TODO: Find out how to use the scopes to organize the variables
		const id = this._variableHandles.get(args.variablesReference);
		let res = {}
		if (id === 'local') {
		  res = {...ress['Local Variables']}
		} else if (id === 'state') {
		  res = {...ress['State Variables']}
		}
		Object.entries(res).forEach((entry:any) => {
			const { Right: val } = entry[1] || {}
			if (val) {
			  variables.push({
			  	name: entry[0],
			  	type: "string",
			  	value: `${val}`,
			  	variablesReference: 0
			  })
		    }
		})

		response.body = {
			variables
		};
		this.sendResponse(response);
	}

	protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): Promise<void> {
		const { user, options } = await this.getUserAndOptions();

        await rest.debugResume(user, options)
		this.sendResponse(response);
	}

	protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
		const { user, options } = await this.getUserAndOptions();

        await rest.debugStepOver(user, options)
		this.sendResponse(response);
	}

	protected stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments) {
		response.body = {
			targets: [] //targets.map(t => {
			// 	return { id: t.id, label: t.label };
			// })
		};
		this.sendResponse(response);
	}

	protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): Promise<void> {
		const { user, options } = await this.getUserAndOptions();

        await rest.debugStepIn(user, options)
		this.sendResponse(response);
	}

	protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
		const { user, options } = await this.getUserAndOptions();

        await rest.debugStepOut(user, options)
		this.sendResponse(response);
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
      const { context, expression } = args
      const { user, options } = await this.getUserAndOptions();
      try {
        const ress = await rest.debugPostEval(user, [expression], options)
		const res = (ress || [])[0] || {Left: ''}
		if (res.Right) {
          response.body = {
            result: res.Right,
            variablesReference: 0
          };
          this.sendResponse(response);
		} else {
          const msg = res.Left || '';
		  if (context === 'watch') {
            response.body = {
              result: msg,
              variablesReference: 0
            };
            this.sendResponse(response);
		  }
		}
      } catch (e) {
        console.log(e);
      }
    }

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {

		response.body = {
            dataId: null,
            description: "cannot break on data access",
            accessTypes: undefined,
            canPersist: false
        };

		if (args.variablesReference && args.name) {
			const id = this._variableHandles.get(args.variablesReference);
			if (id === "global") {
				response.body.dataId = args.name;
				response.body.description = args.name;
				response.body.accessTypes = [ "read" ];
				response.body.canPersist = true;
			}
		}

		this.sendResponse(response);
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {

		response.body = {
			breakpoints: []
		};

		for (const dbp of args.breakpoints) {
			// assume that id is the "address" to break on
			const ok = true // this._runtime.setDataBreakpoint(dbp.dataId);
			response.body.breakpoints.push({
				verified: ok
			});
		}

		this.sendResponse(response);
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void {

		response.body = {
			targets: [
				{
					label: "item 10",
					sortText: "10"
				},
				{
					label: "item 1",
					sortText: "01"
				},
				{
					label: "item 2",
					sortText: "02"
				},
				{
					label: "array[]",
					selectionStart: 6,
					sortText: "03"
				},
				{
					label: "func(arg)",
					selectionStart: 5,
					selectionLength: 3,
					sortText: "04"
				}
			]
		};
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancelationTokens.set(args.requestId, true);
		}
		if (args.progressId) {
			this._cancelledProgressId= args.progressId;
		}
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
		this._ws.close();
		this.sendResponse(response);
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		if (command === 'toggleFormatting') {
			this._showHex = ! this._showHex;
			if (this._useInvalidatedEvent) {
				this.sendEvent(new InvalidatedEvent( ['variables'] ));
			}
			this.sendResponse(response);
		} else {
			super.customRequest(command, response, args);
		}
	}

	//---- helpers

	private async createSourceFromFilename(fileName: string): Promise<Source> {
		let file = this._sourceMap[fileName];
		if (!file) {
		  let workspaceFolderPath = (vscode.workspace.workspaceFolders || [])[0].uri.path;
          let relativePattern: vscode.RelativePattern = new vscode.RelativePattern(
              workspaceFolderPath,
              '**/'+fileName);

          const files = await vscode.workspace.findFiles(relativePattern, null, 50)
		  file = files[0].path;
		  this._sourceMap[fileName] = file;
		}
	    return this.createSource(file);
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'strato-adapter-data');
	}
}
