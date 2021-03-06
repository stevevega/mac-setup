/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
const discoverSymbolsRequestName = 'discoverSymbols';
const discoverReferencesRequestName = 'discoverReferences';
const forgetRequestName = 'forget';
const knownDocumentsRequestName = 'knownDocuments';
const phpLanguageId = 'php';
var WorkspaceDiscovery;
(function (WorkspaceDiscovery) {
    const delayedDiscoverDebounceTime = 500;
    var delayedDiscoverUriArray = [];
    var delayedDiscoverTimer;
    function checkCacheThenDiscover(uriArray, checkModTime, token) {
        return knownDocumentsRequest(token).then((status) => {
            if (token.isCancellationRequested) {
                return Promise.resolve(0);
            }
            let timestamp = status.timestamp;
            let cachedUriSet = new Set(status.documents);
            let notKnown = [];
            let known = [];
            let uri;
            let uriString;
            for (let n = 0, l = uriArray.length; n < l; ++n) {
                uri = uriArray[n];
                uriString = uri.toString();
                if (cachedUriSet.has(uriString)) {
                    known.push(uri);
                    cachedUriSet.delete(uriString);
                }
                else {
                    notKnown.push(uri);
                }
            }
            return forgetMany(Array.from(cachedUriSet)).then(() => {
                return checkModTime && !token.isCancellationRequested ? filterKnownByModtime(known, timestamp) : Promise.resolve([]);
            }).then((filteredUriArray) => {
                Array.prototype.push.apply(notKnown, filteredUriArray);
                return discover(notKnown, token);
            });
        });
    }
    WorkspaceDiscovery.checkCacheThenDiscover = checkCacheThenDiscover;
    function modTime(uri) {
        return fs.stat(uri.fsPath).then((stats) => {
            return [uri, stats.mtime.getTime()];
        }).catch((err) => {
            if (err && err.message) {
                WorkspaceDiscovery.client.warn(err.message);
            }
            return [uri, 0];
        });
    }
    function filterKnownByModtime(knownUriArray, timestamp) {
        return new Promise((resolve, reject) => {
            if (!timestamp || knownUriArray.length < 1) {
                resolve(knownUriArray);
            }
            let filtered = [];
            let onResolved = (result) => {
                if (result[1] > timestamp) {
                    //was modified since last shutdown
                    filtered.push(result[0]);
                }
                --count;
                if (count < 1) {
                    resolve(filtered);
                }
                else {
                    let uri = knownUriArray.pop();
                    if (uri) {
                        modTime(uri).then(onResolved);
                    }
                }
            };
            let count = knownUriArray.length;
            knownUriArray = knownUriArray.slice(0);
            let batchSize = Math.min(4, count);
            let uri;
            while (batchSize-- > 0 && (uri = knownUriArray.pop())) {
                modTime(uri).then(onResolved);
            }
        });
    }
    function forgetMany(uriArray) {
        return new Promise((resolve, reject) => {
            if (uriArray.length < 1) {
                resolve();
            }
            uriArray = uriArray.slice(0);
            let count = uriArray.length;
            let batchSize = Math.min(4, count);
            let onFulfilled = () => {
                --count;
                if (count < 1) {
                    resolve();
                }
                else {
                    let uri = uriArray.pop();
                    if (uri) {
                        forgetRequest(uri).then(onFulfilled, onFailed);
                    }
                }
            };
            let onFailed = (msg) => {
                WorkspaceDiscovery.client.warn(msg);
                onFulfilled();
            };
            let uri;
            while (batchSize-- > 0 && (uri = uriArray.pop())) {
                forgetRequest(uri).then(onFulfilled, onFailed);
            }
        });
    }
    function discover(uriArray, token) {
        return discoverSymbolsMany(uriArray, token).then(() => { return discoverReferencesMany(uriArray, token); });
    }
    WorkspaceDiscovery.discover = discover;
    function delayedDiscover(uri) {
        clearTimeout(delayedDiscoverTimer);
        delayedDiscoverTimer = undefined;
        if (delayedDiscoverUriArray.indexOf(uri) < 0) {
            delayedDiscoverUriArray.push(uri);
        }
        delayedDiscoverTimer = setTimeout(delayedDiscoverFlush, delayedDiscoverDebounceTime);
    }
    WorkspaceDiscovery.delayedDiscover = delayedDiscover;
    function delayedDiscoverFlush() {
        if (!delayedDiscoverTimer) {
            return;
        }
        clearTimeout(delayedDiscoverTimer);
        delayedDiscoverTimer = undefined;
        discover(delayedDiscoverUriArray);
        delayedDiscoverUriArray = [];
    }
    WorkspaceDiscovery.delayedDiscoverFlush = delayedDiscoverFlush;
    function forget(uri) {
        return forgetRequest(uri);
    }
    WorkspaceDiscovery.forget = forget;
    function discoverSymbols(uri) {
        return readTextDocumentItem(uri).then(discoverSymbolsRequest);
    }
    function discoverSymbolsMany(uriArray, token) {
        return discoverMany(discoverSymbols, uriArray, token);
    }
    function discoverReferences(uri) {
        return readTextDocumentItem(uri).then(discoverReferencesRequest);
    }
    function discoverReferencesMany(uriArray, token) {
        return discoverMany(discoverReferences, uriArray, token);
    }
    function discoverMany(discoverFn, uriArray, token) {
        if (uriArray.length < 1 || (token && token.isCancellationRequested)) {
            return Promise.resolve(0);
        }
        return new Promise((resolve, reject) => {
            let remaining = uriArray.length;
            let items = uriArray.slice(0);
            let item;
            let maxOpenFiles = 8;
            let cancelled = false;
            let onAlways = () => {
                --remaining;
                let uri;
                if (cancelled) {
                    return;
                }
                else if (remaining < 1 || (token && token.isCancellationRequested && !cancelled)) {
                    if (token && token.isCancellationRequested) {
                        cancelled = true;
                    }
                    resolve(uriArray.length);
                }
                else if (uri = items.pop()) {
                    discoverFn(uri, token).then(onResolve).catch(onReject);
                }
            };
            let onResolve = (n) => {
                onAlways();
            };
            let onReject = (errMsg) => {
                WorkspaceDiscovery.client.warn(errMsg);
                onAlways();
            };
            while (maxOpenFiles > 0 && (item = items.pop())) {
                discoverFn(item, token).then(onResolve).catch(onReject);
                --maxOpenFiles;
            }
        });
    }
    function readTextDocumentItem(uri) {
        return new Promise((resolve, reject) => {
            fs.readFile(uri.fsPath, (readErr, data) => {
                if (readErr) {
                    reject(readErr.message);
                    return;
                }
                let doc = {
                    uri: uri.toString(),
                    text: data.toString(),
                    languageId: phpLanguageId,
                    version: 0
                };
                if (doc.text.length > WorkspaceDiscovery.maxFileSizeBytes) {
                    reject(`${uri} exceeds maximum file size.`);
                    return;
                }
                resolve(doc);
            });
        });
    }
    function forgetRequest(uri) {
        return WorkspaceDiscovery.client.sendRequest(forgetRequestName, { uri: uri.toString() });
    }
    function discoverSymbolsRequest(doc) {
        return WorkspaceDiscovery.client.sendRequest(discoverSymbolsRequestName, { textDocument: doc });
    }
    function discoverReferencesRequest(doc) {
        return WorkspaceDiscovery.client.sendRequest(discoverReferencesRequestName, { textDocument: doc });
    }
    function knownDocumentsRequest(token) {
        return WorkspaceDiscovery.client.sendRequest(knownDocumentsRequestName, token);
    }
})(WorkspaceDiscovery = exports.WorkspaceDiscovery || (exports.WorkspaceDiscovery = {}));
//# sourceMappingURL=workspaceDiscovery.js.map