/*
************************************************************************
Copyright (c) 2013 UBINITY SAS

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*************************************************************************
*/

// Dumb bridge between the web page and the packaged application

var DEBUG = true;

function debug(message) {
  if (DEBUG) {
    console.log(message);
  }
}

var port = chrome.runtime.connect("mgbemnbocfpecccpecgommbeilnainej");

port.onMessage.addListener(function(msg) {
	debug("Forwarding back to application");
	debug(msg);
	window.postMessage(msg, "*");
});

debug("Embedded script is here");

window.addEventListener("message", function(event) {
  debug("Got message");
  debug(event);
  /*
  if (event.source != window)
    return;
  */

  if (event.data['destination'] && (event.data['destination'] == "PUP_EXT")) {
    debug("Content script received: " + event.data);

    port.postMessage(event.data);
  }
}, false);

