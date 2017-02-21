/*

  RPi-GPS-Wifi logger
  (c+) tobozo 2016-11-13

 */

// load app stack
const app = require('express')()
  , http = require('http').Server(app)
  , io = require('socket.io')(http)
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

// tell express to use ejs for rendering HTML files:
app.set('views', htmlDir);
app.engine('html', require('ejs').renderFile);

// feed the dashboard with the apiKey
app.get('/', function(req, res) {
  res.render('dashboard.html', { });
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
    
    socket.on('serial', function(data) {
      port.write(data.toString()+"\r", (err) => {
        if (err) { return console.log('Error: ', err.message) }
        console.log('message written', data.toString());
      });
    })
  });


});



const serialToJSONData = function(serialdata) {

  /*
   * { "aps":[ {"id": 17,"channel": 6,"mac": "01:09:80:B6:eA:Ce","ssid": "blahblah","rssi": -52,"encryption": "WPA*","vendor": "Z-Com","selected": false}] }
   * { "clients":[{"id": 0,"packets": 3,"mac": "82:18:F8:D1:A2:Ec","name": "","vendor": "SamsungE","selected": 0}] }
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



// User hit Ctrl + C
process.on('SIGINT', function() {
    console.log("\n");

    if (killing_app) {
        console.log("[INFO] Double SIGINT, Killing without cleanup!");
        process.exit();
    }

    killing_app = true;
    console.log("[INFO] Gracefully shutting down from SIGINT (Ctrl+C)");

});
