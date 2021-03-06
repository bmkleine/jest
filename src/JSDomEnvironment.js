/**
 * Copyright (c) 2014, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const FakeTimers = require('./lib/FakeTimers');
const utils = require('./lib/utils');

const USE_JSDOM_EVAL = false;

class JSDomEnvironment {

  constructor(config) {
    // We lazily require jsdom because it takes a good ~.5s to load.
    //
    // Since this file may be require'd at the top of other files that may/may
    // not use it (depending on the context -- such as TestRunner.js when
    // operating as a workerpool parent), this is the best way to ensure we
    // only spend time require()ing this when necessary.
    const jsdom = require('jsdom');
    this.document = jsdom.jsdom(/* markup */undefined, {
      url: config.testURL,
      resourceLoader: this._fetchExternalResource.bind(this),
      features: {
        FetchExternalResources: ['script'],
        ProcessExternalResources: ['script'],
      },
    });
    this.global = this.document.defaultView;

    // Node's error-message stack size is limited at 10, but it's pretty useful
    // to see more than that when a test fails.
    this.global.Error.stackTraceLimit = 100;

    // Forward some APIs
    this.global.Buffer = Buffer;
    this.global.process = process;

    // Setup defaults for navigator.onLine
    this.global.navigator.onLine = true;

    if (typeof setImmediate === 'function') {
      this.global.setImmediate = setImmediate;
      this.global.clearImmediate = clearImmediate;
    }

    this.fakeTimers = new FakeTimers(this.global);

    // I kinda wish tests just did this manually rather than relying on a
    // helper function to do it, but I'm keeping it for backward compat reasons
    // while we get jest deployed internally. Then we can look into removing it.
    //
    // #3376754
    if (!this.global.hasOwnProperty('mockSetReadOnlyProperty')) {
      this.global.mockSetReadOnlyProperty = function(obj, property, value) {
        obj.__defineGetter__(property, function() {
          return value;
        });
      };
    }

    // Apply any user-specified global vars
    const globalValues = utils.deepCopy(config.globals);
    for (const customGlobalKey in globalValues) {
      // Always deep-copy objects so isolated test environments can't share
      // memory
      this.global[customGlobalKey] = globalValues[customGlobalKey];
    }
  }

  dispose() {
    this.global.close();
  }

  /**
   * Evaluates the given source text as if it were in a file with the given
   * name. This method returns nothing.
   */
  runSourceText(sourceText, fileName) {
    if (!USE_JSDOM_EVAL) {
      const vm = require('vm');
      vm.runInContext(sourceText, this.document._ownerDocument._global, {
        filename: fileName,
        displayErrors: false,
      });
      return;
    }

    // We evaluate code by inserting <script src="${filename}"> into the
    // document and using jsdom's resource loader to simulate serving the
    // source code.
    this._scriptToServe = sourceText;

    const scriptElement = this.document.createElement('script');
    scriptElement.src = fileName;

    this.document.head.appendChild(scriptElement);
    this.document.head.removeChild(scriptElement);
  }

  _fetchExternalResource(
    resource,
    callback
  ) {
    const content = this._scriptToServe;
    let error;
    delete this._scriptToServe;
    if (content === null || content === undefined) {
      error = new Error('Unable to find source for ' + resource.url.href);
    }
    callback(error, content);
  }

  runWithRealTimers(cb) {
    this.fakeTimers.runWithRealTimers(cb);
  }

}

module.exports = JSDomEnvironment;
