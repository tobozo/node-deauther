/*

  node-esp8266-deauther Serial to HTTP Bridge
  
  (c+) tobozo 2017-03-05
  
  Requirements: an ESP8266 running esp8266_deauther in SerialServer mode
  and connected to the serial port

    - https://github.com/tobozo/SerialServer
    - https://github.com/spacehuhn/esp8266_deauther

  This module will act as a proxy for static files only.
  
  
    
 */

// load app stack
const app = require('express')()
  , http = require('http').Server(app)
  , fs = require('fs')
  , SerialPort = require('serialport')
;

// throw some vars
let connected = false
  , killing_app = false
  , htmlDir =  __dirname + '/www'
  , port
  , listener
  , serialstack = []
  , httpstack = {}
  , queryqueue = []
;



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

port.on('error', (err) => {
    throw(err.message);
});

port.on('data', function(data) {

  let delims = 0;
  
  serialstack.push(data);

  // build http query from collected elements
  serialstack.forEach(function(stack, index) {
    if(stack==='') delims++;
    if(delims===0) {
      if(stack.length===undefined) return; // header already processed
      if(stack.length<1024) {
        let parts = stack.split(':');
        if(parts.length===2) {
          if(httpstack[parts[0].trim()]!==undefined) return;
          //console.log('got header', parts);
          httpstack[parts[0].trim()] = parts[1].trim();
        }
      }
    }
  });
  
  if(data.trim()==='') { // separator or ending delimiter found
    if(delims==2) {
      if(httpstack['Content-Length']!==undefined) {
        if(httpstack['body'].length == 0- -httpstack['Content-Length']) {
          // yay ! 
          handleHTTPResponse(httpstack);
        } else {
          // size mismatch ?
          console.log('size mismatch', httpstack['Content-Length'], httpstack['body'].length);
        }
      } else {
        // multiline or malformed HTTP request ?
        console.log('multiline query');
      }

    }
  } else {
    if(delims>0) { // body
      //console.log('stack len', data.length);
      if(httpstack['body']===undefined) {
        httpstack['body'] = data;
      } else {
        httpstack['body'] += data;
      }
    } else { // headers
      //console.log(data);
    }
  }
  
});

// tell express to use ejs for rendering HTML files:
app.set('views', htmlDir);

// Handle 404 - Keep this as a last route
app.use(function(req, res, next) {
    
    if (fs.existsSync(htmlDir + req.originalUrl)) {
      res.sendFile(htmlDir + req.originalUrl);
      return;
    }
    
    if(httpstack.state===undefined) {
      // forward to serial
      console.log('forwarding query to serial:', req.originalUrl);
      
      httpstack = {};
      httpstack.state = 'waiting';
      httpstack.req = req;
      httpstack.res = res;
      
      forwartHTTPToSerial(req.originalUrl);

    } else {
     
      queryqueue.push({
        res:res,
        req:req
      });
      
      console.log('queued query:', req.originalUrl, queryqueue.length, 'behind');

    }

});

http.listen(3000, function() {
  console.log('[INFO] Web Server GUI listening on *:3000');
});

const forwartHTTPToSerial = function(requestUri) {
  port.write("GET "+ requestUri + " HTTP/1.1\r", (err) => {
    if (err) { return console.log('Error: ', err.message) }
  });
}


const httpStackOnComplete = function() {
  httpstack = {};
  if(queryqueue.length!==undefined && queryqueue.length>0) {
    httpstack.state = 'waiting';
    httpstack.req = queryqueue[0].req;
    httpstack.res = queryqueue[0].res;
    console.log('queue query to serial:', queryqueue[0].req.originalUrl);
    forwartHTTPToSerial(queryqueue[0].req.originalUrl);
    queryqueue.shift();
  }
}


const handleHTTPResponse = function(httpstack) {
  let keys = Object.keys(httpstack);
  let success = false;
  let res = httpstack.res;
  let req = httpstack.req;
  
  if(res===undefined) {
    console.log('query died');
    httpStackOnComplete();
    return;
  }
  
  keys.forEach(function(key) {
    if(key=='res' || key=='req' || key=='oncomplete') return;
    if(key!=='body') {
      //console.log(key, httpstack[key]);
      if(key.match(/^[a-z0-9_-]+$/i)) {
        res.setHeader(key, httpstack[key]); 
      } else {
        //console.log('skipping poisonous header', key); 
      }
    } else {
      res.end(httpstack['body']);
      success = true;
      
      if( !req.originalUrl.includes('.json') ) {
        // persist only static files
        fs.writeFile(htmlDir + req.originalUrl, httpstack['body'], function(err) {
          if(err) { return console.log(err); }
        });
      }
      httpStackOnComplete();
    }
  });
  serialstack = [];
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
