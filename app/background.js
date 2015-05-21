/*
************************************************************************
Copyright (c) 2013-2014 Ubinity SAS 

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

'use strict';

var DEBUG = false;
var authorizedCallers = [];
var URLPARSER = /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*):?([^:@]*))?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/;

function loadAuthorizedCallers() {
  chrome.storage.sync.get(function(result) {
    debug("Authorized callers");
    debug(result);
    if (typeof result['authorizedCallers'] == "undefined") {
        chrome.storage.sync.set({ 'authorizedCallers' : []});
    }
    else {
      authorizedCallers = result['authorizedCallers'];
    }
  });
}

// Keep application active
window.setInterval(function() {}, 5000);

function debug(message) {
  if (DEBUG) {
    console.log(message);
  }
}

function dump(array) {
  var hexchars = '0123456789ABCDEF';
  var hexrep = new Array(array.length * 2);

  for (var i = 0; i < array.length; i++) {
    hexrep[2 * i] = hexchars.charAt((array[i] >> 4) & 0x0f);
    hexrep[2 * i + 1] = hexchars.charAt(array[i] & 0x0f);
  }
  return hexrep.join('');  
}

function hexToArrayBuffer(h) {
  var result = new ArrayBuffer(h.length / 2);
  var hexchars = '0123456789ABCDEFabcdef';
  var res = new Uint8Array(result);
  for (var i = 0; i < h.length; i += 2) {
    if (hexchars.indexOf(h.substring(i, i + 1)) == -1) break;
    res[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  return result;
}

function winUSBDevice(hardwareId) {  
    this.hardwareId = hardwareId;
    this.closedDevice = false;
    this.claimed = false;    
    this.device = hardwareId.device;
    // Mark claimed
    for (var i=0; i<winUSBDevice.unclaimedDevices.length; i++) {
      if (winUSBDevice.unclaimedDevices.handle == this.device.handle) {
          winUSBDevice.unclaimedDevices[i] = undefined;
          break;
      }
    }
    // Locate the interface to open, the in/out endpoints and their sizes
    for (var i=0; i<hardwareId.interfaces.length; i++) {
      if (hardwareId.interfaces[i].interfaceClass == 0xff) {
          this.interfaceId = i;
          var currentInterface = hardwareId.interfaces[i];
          for (var j=0; j<currentInterface.endpoints.length; j++) {
              var currentEndpoint = currentInterface.endpoints[j];
              if (currentEndpoint.direction == "in") {
                  this.inEndpoint = 0x80 + currentEndpoint.address;
              }
              else
              if (currentEndpoint.direction == "out") {
                  this.outEndpoint = currentEndpoint.address;
              }
          }
      }
    }
}

winUSBDevice.prototype.open = function(callback) {
    debug("Open winUSBDevice " + this.interfaceId);
    debug(this.device);
    var currentDevice = this;
    chrome.usb.claimInterface(this.device, this.interfaceId, function() {
        currentDevice.claimed = true;
        if (callback) callback(true);
    });
}

winUSBDevice.prototype.send = function(data, callback) {
      debug("=> " + data);
      chrome.usb.bulkTransfer(this.device,
        {
          direction: "out",
          endpoint: this.outEndpoint,
          data: hexToArrayBuffer(data)
        },        
        function(result) {                  
          if (callback) {
            var exception = (result.resultCode != 0 ? "error " + result.resultCode : undefined);            
            callback({
              resultCode: result.resultCode,            
              exception: exception
            });
          }
        });
}

winUSBDevice.prototype.recv = function(size, callback) {
      chrome.usb.bulkTransfer(this.device,
        {
          direction: "in",
          endpoint: this.inEndpoint,
          length: size
        },
        function(result) {
            var data;
            if (result.resultCode == 0) {
              data = dump(new Uint8Array(result.data));
            }
            debug("<= " + data);
            if (callback) {
                var exception = (result.resultCode != 0 ? "error " + result.resultCode : undefined);
                callback({
                  resultCode: result.resultCode,
                  data: data,
                  exception: exception
              });
            }
        });
}

winUSBDevice.prototype.close = function(callback) {
    var currentDevice = this;  
    if (this.claimed) {
      chrome.usb.releaseInterface(this.device, this.interfaceId, function() {
        currentDevice.claimed = false;
        chrome.usb.closeDevice(currentDevice.device, function() {
          currentDevice.closedDevice = true;
          if (callback) callback();
        });        
      });
    }
    else
    if (!this.closedDevice) {
        chrome.usb.closeDevice(currentDevice.device, function() {
          currentDevice.closedDevice = true;
          if (callback) callback();
        });        
    }
    else {
      if (callback) callback();
    }
}

winUSBDevice.unclaimedDevices = [];

winUSBDevice.enumerate = function(vid, pid, callback) {
  // First close all unclaimed devices to avoid leaking
  for (var i=0; i<winUSBDevice.unclaimedDevices.length; i++) {
    if (typeof winUSBDevice.unclaimedDevices[i] != "undefined") {
      debug("Closing");
      debug(winUSBDevice.unclaimedDevices[i]);
      chrome.usb.closeDevice(winUSBDevice.unclaimedDevices[i]);
    }
  }
  winUSBDevice.unclaimedDevices = [];
  chrome.usb.findDevices({
    vendorId: vid,
    productId: pid
  },
  function(devices) {
    debug(devices);

    var probedDevicesWithInterfaces = [];
    var probedDevices = 0;

    if (devices.length == 0) {
      // No devices, answer immediately
      if (callback) callback([]);
    }          

    // Locate suitable interfaces
                              
    for (var currentDevice=0; currentDevice<devices.length; currentDevice++) {
      (function(currentDevice) { 
        chrome.usb.listInterfaces(devices[currentDevice], function(interfaceList) {
          probedDevices++;
          // If the device has at least one WinUSB interface, it can be probed
          var hasWinUSB = false;
          for (var i=0; i<interfaceList.length; i++) {
            if (interfaceList[i].interfaceClass == 0xff) {
              hasWinUSB = true;
              break;
            }
          }
          if (hasWinUSB) {
            winUSBDevice.unclaimedDevices.push(devices[currentDevice]);
            probedDevicesWithInterfaces.push({
              device: devices[currentDevice],
              interfaces: interfaceList,
              transport: 'winusb'
            });
          }
          else {
            debug("Closing");
            debug(devices[currentDevice]);
            chrome.usb.closeDevice(devices[currentDevice]);
          }
          if (probedDevices == devices.length) {
            if (callback) callback(probedDevicesWithInterfaces);
          }
        }); // chrome.usb.listInterfaces
      })(currentDevice); // per device closure
    }
  }); // chrome.usb.findDevices    
}


function hidDevice(hardwareId) {
    this.hardwareId = hardwareId;
    this.closedDevice = false;
    this.claimed = false;
    this.device = hardwareId.device;
}

hidDevice.prototype.open = function(callback) {
    debug("Open hidDevice");
    debug(this.device);
    var currentDevice = this;
    chrome.hid.connect(this.device.deviceId, function(handle) {
        if (!handle) {
          debug("failed to connect");
          if (callback) callback(false);
        }
        currentDevice.claimed = true;
        currentDevice.handle = handle;
        if (callback) callback(true);
    });
}

hidDevice.prototype.send = function(data, callback) {
  debug("=> " + data);
  chrome.hid.send(this.handle.connectionId, 0, hexToArrayBuffer(data), function() {
    if (callback) {
      var exception = (chrome.runtime.lastError ? "error " + chrome.runtime.lastError : undefined);            
        callback({
          resultCode: 0,            
          exception: exception
        });
    }
  });
}

hidDevice.prototype.recv = function(size, callback) {
  chrome.hid.receive(this.handle.connectionId, function(reportId, data) {
    var receivedData;
    if (!chrome.runtime.lastError && data) {
      receivedData = dump(new Uint8Array(data));
    }
    debug("<= " + receivedData);
    if (callback) {
      var exception = ((chrome.runtime.lastError || !data) ? "error " + chrome.runtime.lastError : undefined);
      callback({
        resultCode: 0,
        data: receivedData,
        exception: exception
      });
    }
  });
}

hidDevice.prototype.close = function(callback) {
    var currentDevice = this;  
    if (this.claimed) {
      chrome.hid.disconnect(this.handle.connectionId, function() {
        currentDevice.claimed = false;
        currentDevice.closedDevice = true;
        if (callback) callback();
      })
    }
    else {
      currentDevice.closedDevice = true;
      if (callback) callback();
    }
}

hidDevice.enumerate = function(vid, pid, usagePage, callback) {
  function enumerated(deviceArray) {
    var probedDevices = [];
    for (var i=0; i<deviceArray.length; i++) {
      probedDevices.push({
        device: deviceArray[i],
        transport: 'hid'
      });
    }
    if (callback) callback(probedDevices);
  }

  var done = false;

  if (!chrome.hid) {
    // Chrome < 38
    debug("HID is not available");
    enumerated([]);
    return;
  }

  if (typeof usagePage != 'undefined') {
    try {
      // Chrome 39+ only
      chrome.hid.getDevices({filters: [{usagePage: usagePage}]}, enumerated);      
      done = true;
    }
    catch(e) {      
    }
  }
  if (!done) {
    try {
      // Chrome 39+ only
      chrome.hid.getDevices({filters: [{vendorId: vid, productId:pid}]}, enumerated);
      done = true;
    }
    catch(e) {      
      debug(e);
    }    
  }
  if (!done) {
    try {
      chrome.hid.getDevices({vendorId: vid, productId:pid}, enumerated);
    }
    catch(e) {
      debug("All HID enumeration methods failed");
      enumerated([]);
    }
  }
}

chrome.runtime.onConnectExternal.addListener(function(port) {

  var boundDevices = [];
  var authorized = false;
  var prompted = false;

  debug("Connect External to port " + port.name + " from url " + port.sender.url + " id " + port.sender.id);

  function processMessage(msg) {

    debug("Received");
    debug(msg);
    // Message integrity
    if ((typeof msg.destination == "undefined") || (msg.destination != "PUP_EXT")) {
      return; // unhandled
    }
    if (typeof msg.command == "undefined") {
      return; // unhandled
    }
    if (typeof msg.id == "undefined") {
      return; // unhanded
    }

  /*
   {
        destination: "PUP_EXT",
        command: "ENUMERATE",
        id: xxx,
        parameters: {
            pid: optional,
            vid: optional
        }

  }

   {
        destination: "PUP_APP",
        command: "ENUMERATE",
        id: xxx,
        response: {
            deviceList: []
        }

  }
  */

    if (msg.command == "ENUMERATE") {
      var vid = 0x2581;
      var pid = 0x1808;
      var vidHid = 0x2581;
      var pidHid = 0x1807;
      var usagePage = undefined;
      var parameters = msg.parameters;
      if (typeof parameters.vid != "undefined") {
        vid = parameters.vid;
        vidHid = parameters.vid;
      }
      if (typeof parameters.pid != "undefined") {
        pid = parameters.pid;
        pidHid = parameters.pid;
      }
      if (typeof parameters.usagePage != "undefined") {
        usagePage = parameters.usagePage;
      }
      debug("Looking up winusb " + vid +  " " + pid + " / hid " + vidHid + " / " + pidHid);

      checkPermission(vid, pid);
      if (chrome.hid) {
        checkPermission(vidHid, pidHid);
      }      

      winUSBDevice.enumerate(vid, pid, function(devicesWinUSB) {
        debug("WinUSB devices");
        debug(devicesWinUSB);
        hidDevice.enumerate(vidHid, pidHid, usagePage, function(devicesHID) {
          debug("HID devices");
          debug(devicesHID);
          for (var i=0; i<devicesHID.length; i++) {
            devicesWinUSB.push(devicesHID[i]);
          }
          port.postMessage(
            {
              destination: "PUP_APP",
              command: "ENUMERATE",
              id: msg.id,
              response: {
                deviceList: devicesWinUSB
              }
          });
        });
      });
    }

  /*
   {
        destination: "PUP_EXT",
        command: "OPEN",
        id: xxx,
        parameters: {
            device: probedDeviceWithInterface
        }

  }

   {
        destination: "PUP_APP",
        command: "OPEN",
        id: xxx,
        response: {
            deviceId: xxxx
        }

  }
  */

  if (msg.command == "OPEN") {  
      var parameters = msg.parameters;
      var device;
      if (parameters.device.transport == 'winusb') {
        device = new winUSBDevice(parameters.device);      
      }
      else
      if (parameters.device.transport == 'hid') {
        device = new hidDevice(parameters.device);
      }
      else {
        debug("Unsupported transport");
        port.postMessage(
          {
              destination: "PUP_APP",
              command: "OPEN",
              id: msg.id,
              response: {
                deviceId: 0
              }
           }
        );       
        return; 
      }
      boundDevices.push(device);
      var id = boundDevices.length - 1;
      device.open(function(result) {
        port.postMessage(
          {
              destination: "PUP_APP",
              command: "OPEN",
              id: msg.id,
              response: {
                deviceId: id
              }
           }
        );
      });
  }

  /*
   {
        destination: "PUP_EXT",
        command: "SEND",
        id: xxx,
        parameters: {
            deviceId: xxx
            data: 010203ABCDEF
        }

  }

   {
        destination: "PUP_APP",
        command: "SEND",
        id: xxx,
        response: {
            resultCode: xxx
        }

  }
  */

  if (msg.command == "SEND") {  
      var parameters = msg.parameters;
      var device = boundDevices[msg.parameters.deviceId]
      device.send(parameters.data, function(result) {
        port.postMessage(
          {
              destination: "PUP_APP",
              command: "SEND",
              id: msg.id,
              response: result
           }
        );

      });         
  }

  /*
   {
        destination: "PUP_EXT",
        command: "RECV",
        id: xxx,
        parameters: {
            deviceId: xxx
            size: xxx
        }

  }

   {
        destination: "PUP_APP",
        command: "RECV",
        id: xxx,
        response: {
            resultCode: xxx
            data: 01020304ABCDEF
        }

  }
  */

  if (msg.command == "RECV") {  
      var parameters = msg.parameters;
      var device = boundDevices[msg.parameters.deviceId]
      device.recv(parameters.size, function(result) {
        port.postMessage(
          {
              destination: "PUP_APP",
              command: "RECV",
              id: msg.id,
              response: result
           }
        );

      });         
  }

  /*
   {
        destination: "PUP_EXT",
        command: "CLOSE",
        id: xxx,
        parameters: {
            deviceId: xxx
        }

  }

   {
        destination: "PUP_APP",
        command: "CLOSE",
        id: xxx,
        response: {
        }

  }
  */

  if (msg.command == "CLOSE") {  
      var parameters = msg.parameters;
      var device = boundDevices[msg.parameters.deviceId]
      device.close(function() {
        port.postMessage(
          {
              destination: "PUP_APP",
              command: "CLOSE",
              id: msg.id,
              response: {}
           }
        );

      });         
  }

  /*
   {
        destination: "PUP_EXT",
        command: "PING",
        id: xxx,
        parameters: {
        }

  }

   {
        destination: "PUP_APP",
        command: "PING",
        id: xxx,
        response: {
        }

  }
  */

  if (msg.command == "PING") {  
    port.postMessage(
      {
        destination: "PUP_APP",
        command: "PING",
        id: msg.id,
        response: {}
      }
    );
  }
}

  port.onMessage.addListener(function(msg) {

      if (authorized) {
        processMessage(msg);
        return;
      }

      var key, match;
      var extension = false;
      if (typeof port.sender.url == "string" && match = url.match(URLPARSER)) {
        key = match[1] + "://" + match[6];
      }
      else
      if (typeof port.sender.url != "undefined") {
	       key = port.sender.url;
      }
      else 
      if (typeof port.sender.id != "undefined") {
	       key = port.sender.id;
	       extension = true;
      }
      else {
	       // No source ? Deny 
	       return;
      }

      for (var i=0; i<authorizedCallers.length; i++) {
        if (authorizedCallers[i] == key) {
          authorized = true;
          processMessage(msg);
          return;
        }
      }

      var storageKey;

      if (!extension) {
       storageKey = encodeURIComponent(key);
      }
      else {
	     if (key == "jgbgbfmcojcfkpmblnbadaomjmpdooac") {
		      storageKey = "Authentikator";
	     }	
	     else {
		      storageKey = "Extension " + key;
	     }
      }

      if (!prompted) {
        // Not authorized, prompting once
        prompted = true;
        var notification = window.open('notificationCall.html?sender=' + storageKey, '_blank', 'width=350,height=150');
        notification.onclick = function(event) {
          if (notification !== this) {
            return;
          }        
          var self = this;
          self.close();                    
          authorizedCallers.push(key);
          authorized = true;
          processMessage(msg);                        
          chrome.storage.sync.set({"authorizedCallers" : authorizedCallers}, function() {
            var lastError = chrome.runtime.lastError;
            if (lastError && lastError.message.match("QUOTA_BYTES_PER_ITEM")) {
              authorizedCallers = [];
            } else if (lastError) {
              console.error("Fail to save authorizedCallers :", lastError.message);
            }
          });
        }
      }
  });

  port.onDisconnect.addListener(function(msg) {
    debug("Disconnect");
    debug(msg);
    for (var i=0; i<boundDevices.length; i++) {
        boundDevices[i].close();
    }
  })

});

function checkPermission(vidPids) {
    var usbDevices = [];
    for (var i=0; i<vidPids.length; i++) {
	     usbDevices.push({ "vendorId": vidPids[i][0], "productId": vidPids[i][1] });
    }
    // Check for all permissions with contains fails - check that the usbDevices permission is set
    // Note : this should never trigger now than permissions moved from optional to regular
    chrome.permissions.getAll(
      function(permissions) {
	       permissions = permissions.permissions;
	       for (var i=0; i<permissions.length; i++) {
		        debug(permissions[i]);
		        if ((permissions[i] instanceof Object) && (typeof permissions[i]['usbDevices'] != "undefined")) {
	         		return;
		      }
	     }
       var notification = window.open('notification.html', '_blank', 'width=350,height=150');
       notification.onclick = function(event) {
        if (notification !== this) {
              return;
        }        
        var self = this;
        chrome.permissions.request(
          { permissions: [
            {"usbDevices": usbDevices }
            ]
          },
          function(granted) {
            debug("Permission granted " + granted);
            if (granted) {
              if (self === notification) {
                self.close();
              }
            }
          }
        );                  
       }
      });
}

checkPermission([ [0x2581, 0x1807], [0x2581, 0x1808], [0x2581, 0x1b7c], [0x2581, 0x2b7c], [0x2581, 0xf1d0] ]); 

chrome.app.runtime.onLaunched.addListener(function() {
  window.open("main.html");
});

loadAuthorizedCallers();
