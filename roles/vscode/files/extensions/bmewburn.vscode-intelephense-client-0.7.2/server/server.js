/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_1 = require("vscode-languageserver");
const intelephense_1 = require("intelephense");
// Create a connection for the server. The connection uses Node's IPC as a transport
let connection = vscode_languageserver_1.createConnection(new vscode_languageserver_1.IPCMessageReader(process), new vscode_languageserver_1.IPCMessageWriter(process));
let initialisedAt;
const languageId = 'php';
const discoverRequest = new vscode_languageserver_1.RequestType('discover');
const forgetRequest = new vscode_languageserver_1.RequestType('forget');
const addSymbolsRequest = new vscode_languageserver_1.RequestType('addSymbols');
const importSymbolRequest = new vscode_languageserver_1.RequestType('importSymbol');
let config = {
    debug: {
        enable: false
    },
    completionProvider: {
        maxItems: 100
    },
    diagnosticsProvider: {
        debounce: 1000,
        maxItems: 100
    },
    file: {
        maxSize: 1000000
    }
};
// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities. 
let workspaceRoot;
connection.onInitialize((params) => {
    initialisedAt = process.hrtime();
    connection.console.info('Initialising');
    intelephense_1.Intelephense.initialise();
    connection.console.info(`Initialised in ${elapsed(initialisedAt).toFixed()} ms`);
    workspaceRoot = params.rootPath;
    return {
        capabilities: {
            textDocumentSync: vscode_languageserver_1.TextDocumentSyncKind.Incremental,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            completionProvider: {
                triggerCharacters: ['$', '>', ':']
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ',']
            },
            definitionProvider: true,
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true
        }
    };
});
connection.onDidChangeConfiguration((params) => {
    config = params.settings.intelephense;
    intelephense_1.Intelephense.setCompletionProviderConfig(config.completionProvider);
    intelephense_1.Intelephense.setDiagnosticsProviderDebounce(config.diagnosticsProvider.debounce);
    intelephense_1.Intelephense.setDiagnosticsProviderMaxItems(config.diagnosticsProvider.maxItems);
});
connection.onDidOpenTextDocument((params) => {
    if (params.textDocument.text.length > config.file.maxSize) {
        connection.console.warn(`${params.textDocument.uri} not opened -- over max file size.`);
        return;
    }
    handleRequest(() => {
        intelephense_1.Intelephense.openDocument(params.textDocument);
    }, ['onDidOpenTextDocument', params.textDocument.uri]);
});
connection.onDidChangeTextDocument((params) => {
    handleRequest(() => {
        intelephense_1.Intelephense.editDocument(params.textDocument, params.contentChanges);
    }, ['onDidChangeTextDocument', params.textDocument.uri]);
});
connection.onDidCloseTextDocument((params) => {
    handleRequest(() => {
        intelephense_1.Intelephense.closeDocument(params.textDocument);
    }, ['onDidCloseTextDocument', params.textDocument.uri]);
});
connection.onDocumentSymbol((params) => {
    let debugInfo = ['onDocumentSymbol', params.textDocument.uri];
    return handleRequest(() => {
        let symbols = intelephense_1.Intelephense.documentSymbols(params.textDocument);
        debugInfo.push(`${symbols.length} symbols`);
        return symbols;
    }, debugInfo);
});
connection.onWorkspaceSymbol((params) => {
    let debugInfo = ['onWorkspaceSymbol', params.query];
    return handleRequest(() => {
        let symbols = intelephense_1.Intelephense.workspaceSymbols(params.query);
        debugInfo.push(`${symbols.length} symbols`);
        return symbols;
    }, debugInfo);
});
connection.onCompletion((params) => {
    let debugInfo = ['onCompletion', params.textDocument.uri, JSON.stringify(params.position)];
    return handleRequest(() => {
        let completions = intelephense_1.Intelephense.provideCompletions(params.textDocument, params.position);
        debugInfo.push(`${completions.items.length} items`);
        return completions;
    }, debugInfo);
});
connection.onSignatureHelp((params) => {
    let debugInfo = ['onSignatureHelp', params.textDocument.uri, JSON.stringify(params.position)];
    return handleRequest(() => {
        let sigHelp = intelephense_1.Intelephense.provideSignatureHelp(params.textDocument, params.position);
        debugInfo.push(`${sigHelp ? sigHelp.signatures.length : 0} signatures`);
        return sigHelp;
    }, debugInfo);
});
connection.onDefinition((params) => {
    let debugInfo = ['onDefinition', params.textDocument.uri, JSON.stringify(params.position)];
    return handleRequest(() => {
        return intelephense_1.Intelephense.provideDefinition(params.textDocument, params.position);
    }, debugInfo);
});
let diagnosticsStartMap = {};
intelephense_1.Intelephense.onDiagnosticsStart((uri) => {
    diagnosticsStartMap[uri] = process.hrtime();
});
connection.onDocumentFormatting((params) => {
    let debugInfo = ['onDocumentFormat', params.textDocument.uri];
    return handleRequest(() => {
        return intelephense_1.Intelephense.provideDocumentFormattingEdits(params.textDocument, params.options);
    }, debugInfo);
});
connection.onDocumentRangeFormatting((params) => {
    let debugInfo = ['onDocumentFormat', params.textDocument.uri];
    return handleRequest(() => {
        return intelephense_1.Intelephense.provideDocumentRangeFormattingEdits(params.textDocument, params.range, params.options);
    }, debugInfo);
});
intelephense_1.Intelephense.onPublishDiagnostics((args) => {
    let uri = args.uri;
    debug([
        'sendDiagnostics', uri, `${elapsed(diagnosticsStartMap[uri]).toFixed(3)} ms`, `${memory().toFixed(1)} MB`
    ].join(' | '));
    delete diagnosticsStartMap[uri];
    connection.sendDiagnostics(args);
});
connection.onRequest(discoverRequest, (params) => {
    if (params.textDocument.text.length > config.file.maxSize) {
        connection.console.warn(`${params.textDocument.uri} exceeds max file size.`);
        return;
    }
    let debugInfo = ['onDiscover', params.textDocument.uri];
    return handleRequest(() => {
        let dto = intelephense_1.Intelephense.discover(params.textDocument);
        return dto;
    }, debugInfo);
});
connection.onRequest(forgetRequest, (params) => {
    let debugInfo = ['onForget', params.uri];
    return handleRequest(() => {
        let nForgot = intelephense_1.Intelephense.forget(params.uri);
        debugInfo.push(`${nForgot} symbols`);
        return nForgot;
    }, debugInfo);
});
connection.onRequest(addSymbolsRequest, (params) => {
    let debugInfo = ['onAddSymbols', params.symbolTable.uri];
    return handleRequest(() => {
        intelephense_1.Intelephense.addSymbols(params.symbolTable);
    }, debugInfo);
});
connection.onRequest(importSymbolRequest, (params) => {
    let debugInfo = ['onImportSymbol', params.uri];
    return handleRequest(() => {
        return intelephense_1.Intelephense.importSymbol(params.uri, params.position, params.alias);
    }, debugInfo);
});
// Listen on the connection
connection.listen();
function handleRequest(handler, debugMsgArray) {
    try {
        let start = process.hrtime();
        let t = handler();
        let snap = takeProcessSnapshot(start);
        debugMsgArray.push(`${snap.elapsed.toFixed(3)} ms`, `${snap.memory.toFixed(1)} MB`);
        debug(debugMsgArray.join(' | '));
        return t;
    }
    catch (err) {
        connection.console.error(err.stack);
        return null;
    }
}
function debug(msg) {
    if (config.debug.enable) {
        connection.console.log(`[Debug - ${timeString()}] ${msg}`);
    }
}
function timeString() {
    let time = new Date();
    return time.toLocaleString(undefined, { hour: 'numeric', minute: 'numeric', second: 'numeric' });
}
function takeProcessSnapshot(hrtimeStart) {
    return {
        elapsed: elapsed(hrtimeStart),
        memory: memory()
    };
}
function elapsed(start) {
    if (!start) {
        return -1;
    }
    let diff = process.hrtime(start);
    return diff[0] * 1000 + diff[1] / 1000000;
}
function memory() {
    return process.memoryUsage().heapUsed / 1000000;
}
//# sourceMappingURL=server.js.map