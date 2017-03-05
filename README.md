# node-deauther


This module is a Serial to HTTP frontend for https://github.com/spacehuhn/esp8266_deauther

Requirements: A Working version of the Arduino IDE, and a modified version of the SDK 2.0.0
as specified in the esp8266_deauther's ReadME.

*INSTALLATION*

  - `npm install`
  - Copy the SerialServer folder into the /libraries/ folder of your SDK installation.
  - Modify the esp8266_deauther.ino as follows:

```
    #include <ESP8266WebServer.h>
    // ADD THIS LINE
    #include <SerialServer.h>

    (...)
    // COMMENT OUT THIS LINE
    // ESP8266WebServer(80)
    // ADD THIS LINE
    SerialServer(115200);

```

  - Flash your ESP8266 with the modified ino file and plug it into your USB
  - Edit `index.js` to setup the USB port (default is /dev/ttyUSB0)
  - Run `node index.js`
  - Open your browser at localhost:3000
  - Be patient, it's HTTP over Serial !
