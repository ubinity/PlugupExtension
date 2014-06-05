/*
************************************************************************
Copyright (c) 2013 Ubinity SAS 

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

var authorizedApps;
var enabledAuthorizedApp = [];

function swapActivated(event) {
	var id = parseInt(event.toElement.id.substring(5));
	enabledAuthorizedApp[id] = event.toElement.checked;
}

function saveChanges() {
	var newAuthorized = [];
	for (var i=0; i<authorizedApps.length; i++) {
		if (enabledAuthorizedApp[i]) {
			newAuthorized.push(authorizedApps[i]);
		}
	}
	chrome.storage.sync.set({ 'authorizedCallers' : newAuthorized}, function() {
		getAuthorizedApps();
	});
}

function getAuthorizedApps() {

	chrome.storage.sync.get(function(result) {
		authorizedApps = result.authorizedCallers;
		var tbody = document.getElementsByTagName('tbody')[0];
		var content = "";
		for (var i=0; i<result.authorizedCallers.length; i++) {
			content += "<tr>";
			content += "<td>" + result.authorizedCallers[i] + "</td>";
			content += "<td><input type='checkbox' checked='checked' id='check" + i + "'/></td>";
			content += "</tr>";
			enabledAuthorizedApp.push(true);
		}
		tbody.innerHTML = content;
		var inputs = document.getElementsByTagName('input');
		for (var i=0; i<inputs.length; i++) {
			if (i != inputs.length - 1) {
				inputs[i].onclick = swapActivated;
			}
			else {
				inputs[i].onclick = saveChanges;
			}
		}
	});

}

getAuthorizedApps();
