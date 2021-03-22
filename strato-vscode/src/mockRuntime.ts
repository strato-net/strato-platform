/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { EventEmitter } from 'events';
import * as WebSocket from 'ws';

export interface FileAccessor {
	readFile(path: string): Promise<string>;
}

export interface IMockBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

interface IStepInTargets {
	id: number;
	label: string;
}

interface IStackFrame {
	index: number;
	name: string;
	file: string;
	line: number;
	column?: number;
}

interface IStack {
	count: number;
	frames: IStackFrame[];
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class MockRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[] = [];

	// This is the next line that will be 'executed'
	private _currentLine = 0;
	private _currentColumn: number | undefined;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, IMockBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _breakAddresses = new Set<string>();

	private _noDebug = false;

    private _ws = new WebSocket("ws://localhost:8080/debug/")

	constructor(private _fileAccessor: FileAccessor) {
		super();
    //this._ws.on('message', (bytes) => {
    //  const message = JSON.parse(bytes)
    //  console.log(`From websocket: ${message}`)
			//this.sendEvent('breakpointValidated', undefined);
    //})
	}

	/**
	 * Start executing the given program.
	 */
	public async start(program: string, stopOnEntry: boolean, noDebug: boolean): Promise<void> {

		this._noDebug = noDebug;

		await this.loadSource(program);
		this._currentLine = -1;

		await this.verifyBreakpoints(this._sourceFile);

		if (stopOnEntry) {
			// we step once
			this._ws.send(JSON.stringify({tag: "WSResume"}))
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
	}

	/**
	 * Pause execution to the end/beginning.
	 */
	public pause() {
	  this._ws.send(JSON.stringify({tag: "WSPause"}))
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
	  this._ws.send(JSON.stringify({tag: "WSResume"}))
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		this._ws.send(JSON.stringify({tag: "WSStepOver"}))
	}

	/**
	 * "Step into" for Mock debug means: go to next character
	 */
	public stepIn(targetId: number | undefined) {
	  this._ws.send(JSON.stringify({tag: "WSStepIn"}))
	}

	/**
	 * "Step out" for Mock debug means: go to previous character
	 */
	public stepOut() {
	  this._ws.send(JSON.stringify({tag: "WSStepOut"}))
	}

	public getStepInTargets(frameId: number): IStepInTargets[] {

		const line = this._sourceLines[this._currentLine].trim();

		// every word of the current line becomes a stack frame.
		const words = line.split(/\s+/);

		// return nothing if frameId is out of range
		if (frameId < 0 || frameId >= words.length) {
			return [];
		}

		// pick the frame for the given frameId
		const frame = words[frameId];

		const pos = line.indexOf(frame);

		// make every character of the frame a potential "step in" target
		return frame.split('').map((c, ix) => {
			return {
				id: pos + ix,
				label: `target: ${c}`
			};
		});
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): IStack {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<IStackFrame>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			const stackFrame: IStackFrame = {
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			};
			if (typeof this._currentColumn === 'number') {
				stackFrame.column = this._currentColumn;
			}
			frames.push(stackFrame);
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	public getBreakpoints(path: string, line: number): number[] {

		const l = this._sourceLines[line];

		let sawSpace = true;
		const bps: number[] = [];
		for (let i = 0; i < l.length; i++) {
			if (l[i] !== ' ') {
				if (sawSpace) {
					bps.push(i);
					sawSpace = false;
				}
			} else {
				sawSpace = true;
			}
		}

		return bps;
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public async setBreakPoint(path: string, line: number): Promise<IMockBreakpoint> {

	  this._ws.send(JSON.stringify({tag: "WSAddBreakpoints", contents:[{breakpointFile: path, breakpointLine: line, breakpointColumn: 1}]}))
		const bp: IMockBreakpoint = { verified: true, line, id: this._breakpointId++ };
		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): IMockBreakpoint | undefined {
	  this._ws.send(JSON.stringify({tag: "WSRemoveBreakpoints", contents:[{breakpointFile: path, breakpointLine: line, breakpointColumn: 1}]}))
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	/*
	 * Set data breakpoint.
	 */
	public setDataBreakpoint(address: string): boolean {
		if (address) {
			this._breakAddresses.add(address);
			return true;
		}
		return false;
	}

	public setExceptionsFilters(namedException: string | undefined, otherExceptions: boolean): void {
	}

	/*
	 * Clear all data breakpoints.
	 */
	public clearAllDataBreakpoints(): void {
		this._breakAddresses.clear();
	}

	// private methods

	private async loadSource(file: string): Promise<void> {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			const contents = await this._fileAccessor.readFile(file);
			this._sourceLines = contents.split(/\r?\n/);
		}
	}

	private async verifyBreakpoints(path: string): Promise<void> {

		if (this._noDebug) {
			return;
		}

		const bps = this._breakPoints.get(path);
		if (bps) {
			await this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					if (srcLine.indexOf('lazy') < 0) {
						bp.verified = true;
						this.sendEvent('breakpointValidated', bp);
					}
				}
			});
		}
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}