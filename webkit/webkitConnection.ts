/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import WebSocket = require('ws');
import http = require('http');
import {EventEmitter} from 'events';

/**
 * Implements a Request/Response API on top of a WebSocket for messages that are marked with an `id` property.
 * Emits `message.method` for messages that don't have `id`.
 */
class ResReqWebSocket extends EventEmitter {
    private _pendingRequests = new Map<number, any>();
    private _wsAttached: Promise<WebSocket>;

    /**
     * Attach to the given websocket url
     */
    public attach(wsUrl: string): void {
        this._wsAttached = new Promise((resolve, reject) => {
            let ws = new WebSocket(wsUrl);

            ws.on('open', () => resolve(ws));
            ws.on('message', msgStr => {
                console.log('From target: ' + msgStr);
                this.onMessage(JSON.parse(msgStr));
            });
        });
    }

    /**
     * Send a message which must have an id. Ok to call immediately after attach
     */
    public sendMessage(message: { id: number }): Promise<any> {
        return new Promise((resolve, reject) => {
            this._pendingRequests.set(message.id, resolve);
            this._wsAttached.then(ws => {
                let msgStr = JSON.stringify(message);
                console.log('To target: ' + msgStr);
                ws.send(msgStr);
            });
        });
    }

    private onMessage(message: any): void {
        if (message.id) {
            if (this._pendingRequests.has(message.id)) {
                // Resolve the pending request with this response
                this._pendingRequests.get(message.id)(message);
                this._pendingRequests.delete(message.id);
            } else {
                console.error(`Got a response with id ${message.id} for which there is no pending request, weird.`);
            }
        } else if (message.method) {
            this.emit(message.method, message.params);
        }
    }
}

/**
 * Connects to a target supporting the webkit protocol and sends and receives messages
 */
export class WebKitConnection {
    private _nextId = 1;
    private _socket: ResReqWebSocket;

    constructor() {
        this._socket = new ResReqWebSocket();
    }

    public on(eventName: string, handler: (msg: any) => void): void {
        this._socket.on(eventName, handler);
    }

    public attach(port: number): void {
        getUrl(`http://localhost:${port}/json`).then(jsonResponse => {
            let wsUrl = JSON.parse(jsonResponse)[0].webSocketDebuggerUrl;
            return this._socket.attach(wsUrl);
        }).then(() => {
            // init, enable debugger
            this.sendMessage('Debugger.enable');
        });
    }

    public setBreakpoint(location: WebKitProtocol.Debugger.Location, condition?: string): Promise<WebKitProtocol.Debugger.SetBreakpointResponse> {
        return this.sendMessage('Debugger.setBreakpoint', { location, condition });
    }

    public removeBreakpoint(breakpointId: string): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.removeBreakpoint', { breakpointId })
    }

    public stepOver(): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.stepOver');
    }

    public stepIn(): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.stepInto');
    }

    public stepOut(): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.stepOut');
    }

    public resume(): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.resume');
    }

    public pause(): Promise<WebKitProtocol.Response> {
        return this.sendMessage('Debugger.pause');
    }

    public evaluateOnCallFrame(callFrameId: string, expression: string, objectGroup = 'dummyObjectGroup', returnByValue?: boolean): Promise<WebKitProtocol.Debugger.EvaluateOnCallFrameResponse> {
        return this.sendMessage('Debugger.evaluateOnCallFrame', { callFrameId, expression, objectGroup, returnByValue });
    }

    public runtime_getProperties(objectId: string, ownProperties = false): Promise<WebKitProtocol.Runtime.GetPropertiesResponse> {
        return this.sendMessage('Runtime.getProperties', { objectId, ownProperties });
    }

    public runtime_evaluate(expression: string, objectGroup = 'dummyObjectGroup', contextId?: number, returnByValue = false): Promise<WebKitProtocol.Runtime.EvaluateResponse> {
        return this.sendMessage('Runtime.evaluate', { expression, objectGroup, contextId, returnByValue });
    }

    private sendMessage(method: any, params?: any): Promise<WebKitProtocol.Response> {
        return this._socket.sendMessage({
            id: this._nextId++,
            method,
            params
        });
    }
}

/**
 * Helper function to GET the contents of a url
 */
function getUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(url, response => {
            let jsonResponse = '';
            response.on('data', chunk => jsonResponse += chunk);
            response.on('end', () => {
                resolve(jsonResponse);
            });
        }).on('error', e => {
            reject(e);
        });
    });
}