/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, ContinuedEvent, StoppedEvent,
	ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent, InvalidatedEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, TerminatedEvent
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
import { CliClient } from './cliClient';

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
	private cli: CliClient;
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
	private _status = undefined;
	private _user;
    private _options;
	private _sourceMap = {};

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(filepath: string) {
		super("strato-debug.txt");
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);

        this.cli = new CliClient({
          command: `${process.env.HOME}/.local/bin/solid-vm-cli`,
          args: ['debug', 'source', 'breakpoints', '[]', filepath],
          useContentLengthFraming: false, // true if your tool speaks DAP-style frames
          log: (m) => this.sendEvent({ event: 'output', type: 'event', body: { category: 'console', output: m + '\n' } } as any),
        });

        // Example: subscribe to async tool notifications (push events)
        this.cli.on('notification', (method, params) => {
          if (method === 'status') {
			const contents = params;
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
			    } else {
            		this.sendEvent(new ContinuedEvent(params?.threadId ?? 1, false));
			    }
			}
		  }
          //}
          // map more events as needed…
        });

        this.cli.on('exit', () => {
          this.sendEvent(new TerminatedEvent());
        });
	}

	public async initialize() {
		this._initialized = true;
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

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

    protected async launchRequest(
      response: DebugProtocol.LaunchResponse,
      args: DebugProtocol.LaunchRequestArguments
    ): Promise<void> {
	  this.sendResponse(response);
      // try {
      //   // Example: ask your CLI to start/attach the target program
      //   await this.cli.send('launch', {});
      //   this.sendResponse(response);
      // } catch (e: any) {
      //   response.success = false;
      //   response.message = e?.message ?? String(e);
      //   this.sendResponse(response);
      //   this.sendEvent(new TerminatedEvent());
      // }
    }

    protected async continueRequest(
      response: DebugProtocol.ContinueResponse,
      args: DebugProtocol.ContinueArguments
    ): Promise<void> {
      try {
        const result = await this.cli.send('continue', { threadId: args.threadId });
        response.body = { allThreadsContinued: !!result?.allThreadsContinued };
        this.sendResponse(response);
        this.sendEvent(new ContinuedEvent(args.threadId ?? 1, false));
      } catch (e: any) {
        response.success = false;
        response.message = e?.message ?? String(e);
        this.sendResponse(response);
      }
    }

    protected async disconnectRequest(
      response: DebugProtocol.DisconnectResponse,
      _args: DebugProtocol.DisconnectArguments
    ): Promise<void> {
      try {
        this.cli.notify('disconnect', {});
      } catch {
        await this.cli.dispose();
	  } finally {
        this.sendResponse(response);
      }
    }

	protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) {
      try {
        this.cli.notify('pause', {});
      } catch {
        await this.cli.dispose();
	  } finally {
        this.sendResponse(response);
      }
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const path = args.source.path as string;
		const clientLines = args.lines || [];
		const bps = clientLines.map((l) => ({
			tag: "UnconditionalBP",
			contents: {
				name: path,
				line: l,
				column: 1
			}
		}))

        try {
          this.cli.notify('breakpoints', bps);
        } catch {
          await this.cli.dispose();
	    } finally {
          this.sendResponse(response);
        }
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

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;
        try {
            this.cli.send('trace', {}).then(async (stk) => {
		        const stackFrames: StackFrame[] = []
		        for (let i = 0; i < stk.length; i++) {
		        	const f = stk[i];
					if (f.name && f.name !== '') {
		   	     		const source = this.createSourceFromFilename(f.name)
		   	     		const sf = new StackFrame(i, f.name, source, this.convertDebuggerLineToClient(f.line));
		   	     		sf.column = this.convertDebuggerColumnToClient(f.column);
		   	     		stackFrames.push(sf);
					}
		        }
		        response.body = {
		        	stackFrames,
		        	//no totalFrames: 				// VS Code has to probe/guess. Should result in a max. of two requests
		        	totalFrames: stackFrames.length	// stk.count is the correct size, should result in a max. of two requests
		        	//totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
		        	//totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
		        };
		        this.sendResponse(response);

		    })
        } catch {
          await this.cli.dispose();
          this.sendResponse(response);
        }
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
        this.cli.send('variables', {}).then(async (ress) => {
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
	    });
	}

	protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): Promise<void> {
        try {
        	this.cli.notify('stepOver', {});
        } catch {
        	await this.cli.dispose();
        } finally {
        	this.sendResponse(response);
        }
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
        try {
        	this.cli.notify('stepIn', {});
        } catch {
        	await this.cli.dispose();
        } finally {
        	this.sendResponse(response);
        }
	}

	protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): Promise<void> {
        try {
        	this.cli.notify('stepOut', {});
        } catch {
        	await this.cli.dispose();
        } finally {
        	this.sendResponse(response);
        }
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
      const { context, expression } = args
      try {
        this.cli.send('eval', [expression]).then((ress) => {
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
		});
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

	protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
    	try {
    	  this.cli.notify('disconnect', {});
    	} catch {
    	  await this.cli.dispose();
		} finally {
    	  this.sendResponse(response);
    	}
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

	private createSourceFromFilename(fileName: string): Source {
		let file = this._sourceMap[fileName];
		if (!file) {
		  file = this.createSource(fileName);
		  this._sourceMap[fileName] = file;
		}
		return file;
	}

	private createSource(filePath: string): Source {
		return new Source(filePath, this.convertDebuggerPathToClient(filePath), undefined, undefined, 'strato-adapter-data');
	}
}
