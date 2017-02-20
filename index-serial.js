/*

  RPi-GPS-Wifi logger
  (c+) tobozo 2016-11-13

 */

require('dotenv').config();
require('netinterfaces').patch();

// load app stack
const app = require('express')()
  , http = require('http').Server(app)
  , io = require('socket.io')(http)
//  , gpsd = require("node-gpsd")
//  , GPS = require('gps')
//  , gps = new GPS
  , exec = require('child_process').exec
  , execSync = require("child_process").execSync
  , jsonfile = require('jsonfile')
  , fs = require('fs')
  , Wireless = require('wireless')
  , os = require('os')
  , netif = require('netinterfaces')
;
// throw some vars
let connected = false
  , killing_app = false
  , oldalias = 0
  , oldaliasw = 0
  , wlanup = false
  , nmeawifi = false
  , nmeawifienabled = true
  , secondsSinceLastPoll = 0
  , fixPoll = []
  , lastFix
  , gpsMaxLength = 1000
  , currentFix
  , secondsSinceLastFix = 0
  , dataDir = __dirname + '/data'
  , geoDataDir = dataDir + '/gps/'
  , wifiDataDir = dataDir + '/wifi/'
  , htmlDir =  __dirname + '/www'
  , pollFiles = []
  , wifiFiles = []
  , wifiMaxHistoryItems = 100
  , googleMapsApiKey = process.env.apiKey
  , wifiCache = { }
  , gpstime = new Date()
  , port
  , listener
  , lastDataReceived
;


const GPS_SOURCE = 'serial'; // 'serial' or 'gpsd'




const SerialPort = require('serialport');
const SERIAL_PORT = '/dev/ttyUSB0';
const BAUD_RATE = 115200;
const SERIAL_BUFFER_SIZE = 8;
port = new SerialPort(SERIAL_PORT, {
    baudRate: BAUD_RATE,
    parser: SerialPort.parsers.readline('\r\n')
});
port.on('open', () => {
    console.log('Serial port open, hoping a GPS is there and relaying at '+BAUD_RATE+' bauds');
});
// open errors will be emitted as an error event
port.on('error', (err) => {
    console.log('[ERROR] Serial port: ', err.message);
})


if(googleMapsApiKey===undefined) console.log("[WARN] Missing apiKey in .env file, GUI may suffer");


const wireless = new Wireless({
    iface: 'wlan0',
    updateFrequency: 10, // Optional, seconds to scan for networks
    connectionSpyFrequency: 2, // Optional, seconds to scan if connected
    vanishThreshold: 5 // Optional, how many scans before network considered gone
});


const mkdirSync = function (path) {
  try {
    fs.mkdirSync(path);
  } catch(e) {
    if ( e.code != 'EEXIST' ) throw e;
  }
}


const checkInterfaces = function() {
  const ifaces = os.networkInterfaces();
  const ifacekeys = Object.keys(ifaces);
  const alias = ifacekeys.length;;
  if(oldalias!==0 && oldalias!==alias) {
    console.log('network changed, restarting nodejs app');
    process.exit(0);
  }
  oldalias = alias;
  wirelessState();
};


const setPoll = function() {
  secondsSinceLastFix++;
  secondsSinceLastPoll++;
  if(fixPoll.length === 0) {
    return;
  }
  if(fixPoll.length>=100 || secondsSinceLastPoll>=60) {
    savePoll();
    secondsSinceLastPoll = 0;
  }
};


const setFix = function() {
  if(lastFix===undefined) {
    // not started yet
    return;
  }
  if(currentFix===undefined) {
    // setting initial currentFix
    currentFix = lastFix;
    fixPoll.push(lastFix);
    return;
  }
  if(currentFix.time === lastFix.time) return; // don't create duplicates
  fixPoll.push(lastFix);
  currentFix = lastFix;
}


const savePoll = function() {
  if(fixPoll.length===0) {
    // can't save empty poll!
    return;
  }

  const fileName = geoDataDir + fixPoll[0].time.replace(/[^a-z0-9-]+/gi, '_') + '.json';
  let wifilist = {};
  try {
    wifilist = wireless.list();
  } catch(e) {
    console.log('cannot save wifilist', e);
  }

  jsonfile.writeFile(fileName, fixPoll, {spaces: 2}, function(err) {
    if(err) console.error(err);
    resetPoll();
    refreshPollInventory();
  });

}


const resetPoll = function() {
  fixPoll = [];
}


const refreshPollInventory = function() {
  fs.readdir(geoDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // geodatadir is empty!
      return;
    }

    while(files.length>gpsMaxLength) {
      fs.unlink(geoDataDir + files[0], function() { /* whatever */ });
      console.log('purged gps file', geoDataDir + files[0]);
      files.shift();
    }


    pollFiles = JSON.parse(JSON.stringify(files));
    io.emit('pollsize', pollFiles.length);
  });
}


const sendPollInventory = function() {
  fs.readdir(geoDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // geodatadir is empty!
      return;
    }
    pollFiles = JSON.parse(JSON.stringify(files));
    io.emit('pollfiles', files);
  });
}

const sendPollContent = function(fileName) {
  let pollName = false;
  // console.log('got poll content request', fileName);
  pollFiles.forEach(function(tmpFileName) {
    if(fileName === tmpFileName) {
      pollName = fileName;
    }
  });
  if(pollName===false) return;
  jsonfile.readFile(geoDataDir + pollName, function(err, obj) {
    if(err) {
      console.log(err);
      io.emit('pollfile', {filename:pollName, error: JSON.stringify(err)});
      return;
    }
    io.emit('pollfile', {filename:pollName, content: obj});
  });
}


const sendWifiCache = function() {
  io.emit('wificache', wifiCache);
}

const setWifiCache = function() {
  if(Object.keys(wifiCache).length ===0) return;
  sendWifiCache();
}


const saveWifi = function(wifi, event) {
  const fileName = wifiDataDir + wifi.address.replace(/[^a-z0-9-]+/gi, '_') + '.json';

  jsonfile.readFile(fileName, function(err, obj) {

    if(obj===undefined || (err!==null && err.code==="ENOENT")) {
      // console.log('new wifi device');
      obj = {};
      obj.iface = wifi;
      obj.events = [];
    }

    // prevent database explosion
    if(obj.events.length > wifiMaxHistoryItems) {
      while(obj.events.length > wifiMaxHistoryItems) {
        obj.events.pop();
      }
    }

    obj.events.unshift([gpstime, event, wifi.channel, wifi.quality, wifi.strength]);

    jsonfile.writeFile(fileName, obj, {spaces:0}, function(err, obj) {
      if(err) console.error(err);
    });

  });
}



const sendWifiInventory = function() {
  fs.readdir(wifiDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // wifidatadir is empty!
      return;
    }
    wifiFiles = JSON.parse(JSON.stringify(files));
    io.emit('wififiles', files);
  });
}


const sendWifiContent = function(fileName) {
  let wifiName = false;
  // console.log('got wifi content request', fileName);
  wifiFiles.forEach(function(tmpFileName) {
    if(fileName === tmpFileName) {
      wifiName = fileName;
    }
  });
  if(wifiName===false) return;
  jsonfile.readFile(wifiDataDir + wifiName, function(err, obj) {
    if(err) {
      console.log(err);
      io.emit('wififile', {filename:wifiName, error: JSON.stringify(err)});
      return;
    }
    io.emit('wififile', {filename:wifiName, content: obj});
  });
}


mkdirSync( dataDir );
mkdirSync( geoDataDir );
mkdirSync( wifiDataDir);

setInterval(checkInterfaces, 20000); // check for network change every 20 sec
//setInterval(checkWlanInterfaces, 20000); // check for network change every 20 sec
setInterval(setPoll, 1000);
setInterval(setFix, 1000);
setInterval(setWifiCache, 61000); // force wifi cache reload every minute

// tell express to use ejs for rendering HTML files:
app.set('views', htmlDir);
app.engine('html', require('ejs').renderFile);

// feed the dashboard with the apiKey
app.get('/', function(req, res) {
  res.render('dashboard.html', {
    apiKey: googleMapsApiKey
  });
});

app.get('/jquery-ui-timepicker-addon.js', function(req, res) {
  res.sendFile(htmlDir + '/jquery-ui-timepicker-addon.js');
});

app.get('/dashboard.js', function(req, res) {
  res.sendFile(htmlDir + '/dashboard.js');
});


http.listen(3000, function() {
  console.log('[INFO] Web Server GUI listening on *:3000');

  port.on('data', function(data) {
    
    let out = serialToJSONData(data);
    
    if(out!==false) {
      //console.log('will emit wifi', {change: out});
      io.emit(out.name, out.value);
    } else {
      io.emit('serialdata', data);
    }
  });

  io.sockets.on('connection', function (socket) {

    // auto send ap list  
    port.write("aplist"+"\r", (err) => {
      if (err) { return console.log('Error: ', err.message) }
    });
    
    socket.on('reload', function(data) {
      // foreferjs
      process.exit(0);
    });

    socket.on('poll-files', sendPollInventory);
    socket.on('poll-content', sendPollContent);
    socket.on('wifi-cache', sendWifiCache);
    socket.on('wlan-enable', wirelessEnable);
    socket.on('wlan-disable', wirelessDisable);
    socket.on('wlan-state', wirelessState);
    
    socket.on('serial', function(data) {
      port.write(data.toString()+"\r", (err) => {
        if (err) { return console.log('Error: ', err.message) }
        console.log('message written', data.toString());
      });
    })
    wirelessState();
  });


});

const wirelessState = function() {
  io.emit('wlan-message', {
    wlan: wlanup ? 'wlan-enabled' : 'wlan-disabled',
    nmea: nmeawifienabled&&nmeawifi ? 'nmeawifi-enabled' : 'nmea-wifi-disabled'
  });
}

const wirelessEnable = function() {
  if(wlanup) {
    console.log("[INFO] wlan already enabled");
    wirelessState();
    return;
  }
  console.log("[INFO] Enabling Wireless card.");
  wireless.enable(function(err) {
    if (err) {
        console.log("[FAIL] Unable to enable wireless card. Giving up...");
        wirelessState();
        return;
    }
    console.log("[INFO] Starting wireless scan...");
    wireless.start();
    wlanup = true;
    nmeawifienabled = false;
    wirelessState();
  });
}

const wirelessDisable = function() {
    if(wlanup===false) {
      console.log("[INFO] wlan already disabled");
      wirelessState();
      return;
    }
    console.log("[INFO] Stopping Wireless scan");
    wireless.disable(function() {
        wireless.stop();
        console.log("[INFO] Wireless card disabled.");
        wlanup = false;
        nmeawifienabled = nmeawifi ? true : false;
        wirelessState();
    });
}


const setupWifiData = function(network) {
    network.ssid = network.ssid || '[HIDDEN]';

    network.encryption_type = 'NONE';
    if (network.encryption_wep) {
        network.encryption_type = 'WEP';
    } else if (network.encryption_wpa && network.encryption_wpa2) {
        network.encryption_type = 'WPA-WPA2';
    } else if (network.encryption_wpa) {
        network.encryption_type = 'WPA';
    } else if (network.encryption_wpa2) {
        network.encryption_type = 'WPA2';
    }
    return network;
}


const serialToJSONData = function(serialdata) {

  /*
   * { "aps":[ {"id": 17,"channel": 6,"mac": "00:19:70:96:e4:7e","ssid": "giediprime","rssi": -52,"encryption": "WPA*","vendor": "Z-Com","selected": false}] }
   * { "clients":[{"id": 0,"packets": 3,"mac": "84:38:38:f1:12:8c","name": "","vendor": "SamsungE","selected": 0}] }
   */
  try {
    serialdata = JSON.parse(serialdata);
  } catch(e) { 
    console.log('bad JSON in ', serialdata);
    return false;
  }
  
  let key = Object.keys(serialdata)[0];
  
  switch(key) {
    case 'aps':
      if(serialdata[key].length==1) {
        serialdata = serialdata[key][0];
        
        let retval = {
          name: 'wifi',
          value: { 
            appear: {
              id: serialdata.id,
              address: serialdata.mac,
              channel: serialdata.channel,
              encryption_type: serialdata.encryption,
              strength: serialdata.rssi,
              quality: Math.floor( 10*(100 + (0- -serialdata.rssi))/7 ),
              ssid: serialdata.ssid,
              vendor: serialdata.vendor,
              selected: serialdata.selected
            }
          }
        };
        return retval;
      } else {
        // console.log('multiple result at key ', key, serialdata[key].length);
        return {
          name:key,
          value:serialdata 
        };
      }
    break;
    case 'message':
    case 'clients':
    default:
      return {
        name:key,
        value:serialdata 
      };
    break;
  }
  
  return false;
}


const nmeaToWifiData = function(nmea) {

   let nmeaParts = nmea.split(',');
   let cmd = nmeaParts[0];
   let msg = nmeaParts[1];
   let msgParts;
   msg = msg.split('*')[0];

   switch(cmd) {
     case '$WIFINIC':
       msgParts = msg.split(';');
       //$WIFINIC,24;-49;giediprime;00:19:70:96:E4:7E;6;WPA+WPA2*77
	/*
	address "00:19:70:96:E4:7E"
	channel "6"
	encryption_any  true
	encryption_type "WPA-WPA2"
	encryption_wep  false
	encryption_wpa  true
	encryption_wpa2 true
	last_tick       1
	mode    "Master"
	quality "70"
	ssid    "giediprime"
	strength        "-35"
	*/
      return {
         address: msgParts[3],
         channel: msgParts[4],
         encryption_type: msgParts[5],
         strength: msgParts[1],
         quality: Math.floor( 10*(100 + (0- -msgParts[1]))/7 ),
         ssid: msgParts[2]
       };
     break;
     case '$WIFIINFO':
       //$WIFIINFO, ########## Will rescan ##########*05
       return msg;
     break;
   }
}



// Found a new network
wireless.on('appear', function(network) {
    network = setupWifiData( network );
    io.emit('wifi', {appear:network});
    wifiCache[network.address] = network;
    saveWifi(network, 'appear');
});

wireless.on('change', function(network) {
    network = setupWifiData( network );
    io.emit('wifi', {change:network});
    wifiCache[network.address] = network;
    saveWifi(network, 'change');
});


// A network disappeared (after the specified threshold)
wireless.on('vanish', function(network) {
    io.emit('wifi', {vanish:network});
    if(wifiCache[network.address]!==undefined) {
      delete(wifiCache[network.address]);
    }
    saveWifi(network, 'vanish');
});

wireless.on('error', function(message) {
    // io.emit('wifi', {error:network});
    console.log("[ERROR] Wifi / " + message);
    wirelessDisable();
    /*
    wireless.disable(function() {
        console.log("[INFO] Stopping Wifi and Exiting...");
        wireless.stop();
    });*/

});


// User hit Ctrl + C
process.on('SIGINT', function() {
    console.log("\n");

    if (killing_app) {
        console.log("[INFO] Double SIGINT, Killing without cleanup!");
        process.exit();
    }

    killing_app = true;
    console.log("[INFO] Gracefully shutting down from SIGINT (Ctrl+C)");
    console.log("[INFO] Disabling Wifi Adapter...");

    wirelessDisable();
/*
    wireless.disable(function() {
        console.log("[INFO] Stopping Wifi and Exiting...");

        wireless.stop();
    });
*/
});
