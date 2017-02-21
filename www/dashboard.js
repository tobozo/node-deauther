var wifiCache = {},
    wifiTimeline = [],
    wifiSort = 'quality',
    wifiName = 'ssid',
    wifiSelected = false,
    clientsCache = {},
    clientsRender = false,
    $wifilist = $('.wifi-list')
;

var socket = io();

var rad = function(x) {
    return x * Math.PI / 180;
};

var selectIface = function() {
  socket.emit('serial', 'apselect ' + $(this).attr('data-iface-id') );
  setTimeout(function() {
    socket.emit('serial', 'aplist');
  }, 500);
}


var renderIface = function(iface) {
    var wifibar = '<div class="wifi-bar"></div>';
    var $ifacename = $('<div class="iface-name">'+iface[wifiName]+'</div>');
    var $ifacebox = $('<div class="iface-box"></div>')
    var $signalbox = $('<div class="signal-box"></div>');
    var clearfix = '<div style="clear:both"></div>';
    var signalstrength = Math.floor( iface.quality / 20 );
    var encryption_type = 'none';

    $ifacename.appendTo($ifacebox);

    for(var i=5;i>0;i--) {
        if(signalstrength>=i) {
            $(wifibar).appendTo($signalbox);
        } else {
            $(wifibar).addClass('off').appendTo($signalbox);
        }
    }

    $signalbox.prependTo($ifacebox);

    $ifacebox.css({
        "background-image": "linear-gradient(to right, lightgreen, rgba(125,0,0,0.5) "+ ( iface.quality - 1) + "%, transparent " + iface.quality + "%)"
    });

    if (iface.encryption_wep) {
        encryption_type = 'wep';
    } else if (iface.encryption_wpa && iface.encryption_wpa2) {
        encryption_type = 'wpa-wpa2';
    } else if (iface.encryption_wpa) {
        encryption_type = 'wpa';
    } else if (iface.encryption_wpa2) {
        encryption_type = 'wpa2';
    } else if(iface.encryption_type){
        encryption_type = iface.encryption_type.toLowerCase();
    }

    $ifacename.attr('data-encryption-type', encryption_type);
    $ifacebox.attr('data-iface-id', iface.id);
    $ifacebox.attr('data-iface-addr', iface.address);
    $ifacebox.attr('data-selected', iface.selected);
    $ifacebox.appendTo($wifilist);
    $ifacebox.on('click', selectIface);
    $(clearfix).appendTo($ifacebox);
}


var renderWifiCache = function(data) {
    var ifaceList;
    var now = Date.now();
    if(data!==undefined) {
      ifaceList = Object.keys(data).sort(function(a,b){return data[b][wifiSort]-data[a][wifiSort]});
      wifiCache = data;
    } else {
      ifaceList = Object.keys(wifiCache).sort(function(a,b){return wifiCache[b][wifiSort]-wifiCache[a][wifiSort]});
    }

    wifiSelected = false;
    $wifilist.empty();
    ifaceList.forEach(function(iface) {
      if(now - wifiCache[iface].added > 300000) {
        delete(wifiCache[iface]);
        return;
      }
      if(wifiCache[iface].selected) {
        wifiSelected = true;
      }
      renderIface(wifiCache[iface]);
    });
    $wifilist.attr('data-iface-size', ifaceList.length);
}


var onWifiEvent =  function(data) {
  var event = Object.keys(data)[0];
  var wifi = data[event];
  wifi.added = Date.now();
  switch(event) {
    case 'vanish':
      if(wifiCache[wifi.address]!==undefined) {
        delete(wifiCache[wifi.address]);
      }
    break;
    case 'appear':
    case 'change':
      wifiCache[wifi.address] = wifi;
    break;
  }
}

var renderClient = function(client) {
    var $clientBox = $('<div class="client-box"></div>');
    var $mac = $('<div class="client-mac">'+client.mac+'</div>');
    var $vendor = $('<div class="client-vendor">'+client.vendor+'</div>')
    var $name = $('<div class="client-name">'+client.name+'</div>');
    var $actionbox;
    
    $clientBox.attr({
      'data-id': client.id,
      'data-selected': client.selected,
      'data-packets': client.packets,
      'data-mac': client.mac
    });

    if(client.selected) {
      $('.attack').attr('data-client-id', client.id).prop('disabled', null);
    }
    
    $mac.appendTo( $clientBox );
    $vendor.appendTo( $clientBox );
    $name.appendTo( $clientBox );

    if(!client.selected) {
      $actionbox = $('<button class="select">✔️</button>');
      $actionbox.attr('data-client-id', client.id);
      $actionbox.on('click', function() {
        var $this = $(this);
        var clientid = $this.attr('data-client-id');
        $this.prop('disabled', true);
        $('.attack').attr('data-client-id', null).prop('disabled', true);
        sendSerial('cselect '+clientid);
      });
      $actionbox.appendTo($clientBox);
    }
    $clientBox.appendTo( $('.client-list') );
}

var renderClientCache = function() {
  var clientsList = Object.keys(clientsCache);
  var now = Date.now();
  $('.client-list').empty();
  clientsList.forEach(function(client) {
    renderClient(clientsCache[client]);
  });
  clientsRender = false;
}

var onClientsEvent = function(data) {
   let clients = data.clients;
   clientsCache = {};
   clients.forEach(function(client) {
     clientsCache[client.mac] = client;
     clientsCache[client.mac].added = Date.now();
   });
   clientsRender = true;
}


socket.on('wificache', renderWifiCache);
socket.on('wifi', onWifiEvent);
socket.on('clients', onClientsEvent);
socket.on('serialdata', function(serialdata) {
  console.log('serial data', serialdata);
});
socket.on('message', function(serialdata) {
  console.log('message', serialdata.message[0]);
});


function sendSerial(msg) {
  socket.emit('serial', msg);
}


function init() {

    $clientScanBox = $('.client-wrapper');
   
    $('.client-wrapper button[class^="scan"]').on('click', function() {
      var $this = $(this);
      sendSerial('cscan');
      if($this.hasClass('scan-big')) {
        $this.remove();
      } else {
        $this.prop('disabled', true);
        $this.addClass('spin');
        setTimeout(function() {
          $this.prop('disabled', null);
          $this.removeClass('spin');
        }, 10000);
      }
    });
    
    $('.wifi-wrapper button.refresh').on('click', function() {
      var $this = $(this);
      $this.prop('disabled', true);
      sendSerial('apscan');
      setTimeout(function() {
        $this.prop('disabled', null);  
      }, 10000);
    });
    
    $('button.attack').on('click', function() {
      sendSerial('attack ' + $(this).attr('data-attack'));
      $(this).prop('disabled', null);
    });
    
    setInterval(function() {

      $clientScanBox.toggleClass('blink');
  
      $clientScanBox.attr('data-enabled', wifiSelected);
      if(wifiSelected) {
        if(clientsRender) {
          renderClientCache();
        }
      } else {
        $clientScanBox.find('.client-list').html('Loading...');
      }
      renderWifiCache();

    }, 1000);

}


window.addEventListener('load', init);
