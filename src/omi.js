/*
 * Copyright 2016 Hewlett-Packard Development Company, L.P.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * Software distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and limitations under the License. 
 */


"use strict";

module.exports = function(OMiBot) {

  /* ------------ DEPENDENCIES ------------ */
  var rawbody      = require('express-rawbody'),
      xmlparser    = require('express-xml-bodyparser'),
      parseString  = require('xml2js').parseString,
      Http         = require('http'),
      Https        = require('https'),
      _            = require('lodash'),
      cookieParser = require('cookie').parse,
      config       = require('config.json')('./omi-conf.json');


  /* ------------ CONFIGURATION ------------ */
  var OMiLogin       = config.OMiLogin,
      OMiPassword    = config.OMiPassword,
      OMiHost        = config.OMiHost,
      OMiPort        = config.OMiPort,
      OMiContextRoot = config.OMiContextRoot,
      OMiProtocol    = config.OMiProtocol,
      ServiceManagerName = config.ServiceManagerName;

  /* ------------ GLOBALS ------------ */
  var omiCookies        = '',
      secureModifyToken = '',
      http              = Http,
      eventIDs          = [],  // cache for event IDs
      maxIDs            = 100;


  /* ------------ CHAT HANDLERS IMPLEMENTATION ------------ */

  var chatHandlerEscal = function(res) {
    var eventID = res.match[1];
    var foundIDs = [];

    // first check ii an ID was submitted, if not try to use last.
    if (eventID == null || eventID == "")  { // No ID in command
      if (eventIDs.length > 0) { // some ID in cache
        OMiBot.logger.info('No eventID'+ JSON.stringify(res.match + " .. try use last EventID "));
        eventID = eventIDs[eventIDs.length-1].id;
      } else { // no ID is the cache .. too bad
        OMiBot.logger.info('No eventID submitted '+ JSON.stringify(res.match + " .. and no last event "));
        res.reply("No last event ID found. Please enter the full ID");
      }
    } else { // some 'short' ID, was submitted ... good.
      OMiBot.logger.info('ID:'+ JSON.stringify(res.match));
      foundIDs = [];
      // Search for the right full ID
      var index, len;
      for (index = 0, len = eventIDs.length; index < len; ++index) {
        if (eventIDs[index].id != undefined) {
          if (eventID === eventIDs[index].id.substring(0,eventID.length)) {
            OMiBot.logger.info("ID:" + index + " found " + eventIDs[index].id);
            foundIDs.push(eventIDs[index].id);
          }
        }
      }

      if (foundIDs.length == 0  ) {
        // OMiBot.logger.info("No full ID found for the short ID. Please try to use the full ID");
        res.reply("No full ID found for the short ID. Please try to use the full ID");
      } else if (foundIDs.length > 1 ) {
        // OMiBot.logger.info("Duplicate long IDs found for the short ID. Please enter the full ID");
        res.reply("Duplicate long IDs found for the short ID. Please enter the full ID");
      } else {
        OMiBot.logger.info("Found ID: " + foundIDs[0]);
        eventID = foundIDs[0];
      }
    }

    // Call the OMi REST WS for transfer control if thwere is a eventID
    if (eventID != null && eventID != "") {
      var body = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?> \
          <event xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema" \
          xmlns="http://www.hp.com/2009/software/opr/data_model" relationships_included="true" \
          type="urn:x-hp:2009:software:data_model:opr:type:event" version="1.3"> \
          <control_transferred_to type="urn:x-hp:2009:software:data_model:opr:type:control_transfer_info" version="1.2">\
            <name>' +  ServiceManagerName +  '</name>\
          </control_transferred_to>\
          </event>';

      OMiRestCall(
        {path: '/opr-web/rest/event_list/'+eventID, method: 'PUT', body: body}, function(err, result) {
          if (err) {
            res.reply('Could not esaclate event ' + eventID);
          } else {
            res.reply("Event escalated to " + ServiceManagerName);
          }
        }
      );
    } else {
      OMiBot.logger.info("No valid ID found in cache");
    }
  }; // end: chatHandlerEscal


  /* ------------ HTTP SERVER ROUTERS IMPLEMENTATION ------------ */
  var eventHandler = function eventHandler(req, res) {
    parseString(
      req.rawBody, function(err, event) {
  	    // OMiBot.logger.info(event);
        // Save the event ID for further commands
        event = event.event;
        if (event.id != undefined && event.id != null)
        {
          // Use an array because we might want to keep other attributes
          eventIDs.push({ 'id': event.id[0] });
          OMiBot.logger.info("Added event ID to chache" + event.id[0]);
          if (eventIDs.length > maxIDs) eventIDs.shift();
        }

        var room   = req.params.channel;
        OMiBot.logger.info("room: " + room);
        var result = '';
        var color, fallback, fields, room, title;

        color = "#808080";
        switch (event.severity[0]) {
          case 'unknown':
            color = "#808080"; break;
          case 'normal':
            color = "#00FF00"; break;
          case 'minor':
            color = "#FFFF00"; break;
          case 'warning':
            color = "#00ffff"; break;
          case 'major':
            color = "#ff9900"; break;
          case 'normal':
            color = "good"; break;
          case 'critical':
            color = "#FF0000"; break;
          default:
            color = "#808080";
        }

        var cat = "";
        if (event.category != undefined && event.category != null)
        {
          cat = event.category[0];
        }

        var node = "";
        if (event.node_ref != undefined && event.node_ref != null &&
            event.node_ref[0].node != undefined && event.node_ref[0].node != null &&
            event.node_ref[0].node[0].display_label != undefined
        	  && event.node_ref[0].node[0].display_label != null )
        {
        	node = event.node_ref[0].node[0].display_label[0]
        }

        fields = [
          {
            title: 'Receive Time',
            value: event.time_received[0],
            short: true
          }, {
            title: 'Node',
            value: node,
            short: true
          }, {
            title: 'Category',
            value: cat,
            short: true
          }, {
            title: 'Priority',
            value: event.priority[0],
            short: true
          }, {
            title: 'Short ID',
            value: event.id[0].substring(0,4),
            short: true
          }
        ];
        fallback = event.severity[0] + " : " + node + " : " + event.title[0];
        title = "New " + event.severity[0] + " event on " + node;
        OMiBot.emit('slack-attachment', {
          message: {
            room: room,
            username: 'omi'
          },
          content: {
            title: title,
            title_link: event.drilldown_url[0],
            text: event.title[0],
            color: color,
            pretext: '',
            fallback: fallback,
            fields: fields
          }
        });

        res.setHeader('content-type', 'application/xml');
        return res.send(req.rawBody); // Why to send that back?

      } // req.rawBody
    );  // parseString
  }; // end: eventHandler

  var eventChangeHandler = function eventChangeHandler(req, res) {
    parseString(
      req.rawBody, function(err, event) {
        var room   = req.params.channel,
            result = '';

        event = event.event_change;

        result = 'The following event changed: ' + event.id;

        OMiBot.messageRoom(room, result);
        res.setHeader('content-type', 'application/xml');
        return res.send(req.rawBody);
      }
    );
  }; // end: eventChangeHandler

  var eventConnectHandler = function eventConnectHandler(req, res) {
    // handler to allow setup as event forwarding receiver
    return res.send('OK');
  }; // end: eventConnectHandler

  /* ------------ INIT ------------ */

  function OMiAuthenticate(callback) {
    var auth = 'Basic ' + new Buffer(OMiLogin + ':' + OMiPassword).toString('base64');

    var options = {
          host: OMiHost,
          port: OMiPort,
          path: OMiContextRoot + '/opr-web/rest',
          method: 'GET',
          headers: {
            Authorization: auth
          }
        },

        request = http.request(
          options, function(res) {
            if (res.statusCode !== 200) {
              res.on(
                'data', function(chunk) {
                  OMiBot.logger.info(
                    'Error: unable to authenticate with OMi ' + OMiHost + ':' + OMiPort + '. Status: ' + res.statusCode + '. Server reply:' + chunk
                  );
                }
              );
              if (callback instanceof Function) {
                return callback(true);
              }
              return;
            }

            _.each(
              res.headers['set-cookie'], function(cookie) {
                var c = cookieParser(cookie);

                if ('JSESSIONID' in c) {
                  omiCookies += ' JSESSIONID=' + c.JSESSIONID + ';';
                }
                if ('LWSSO_COOKIE_KEY' in c) {
                  omiCookies += ' LWSSO_COOKIE_KEY=' + c.LWSSO_COOKIE_KEY + ';';
                }
                if ('secureModifyToken' in c) {
                  secureModifyToken = c.secureModifyToken;
                }
              }
            );

            if (callback instanceof Function) {
              return callback(null, true);
            }
          }
        );
    request.on(
      'error', function(error) {
        OMiBot.logger.info('Error: unable to authenticate with OMi ' + OMiHost + ':' + OMiPort + '. Message: ' + error);
        if (callback instanceof Function) {
          return callback(true);
        }
      }
    );
    request.end();
  } // end: OMiAuthenticate

  function OMiRestCall(options, callback) {

    var requestOptions = {
          host: OMiHost,
          port: OMiPort,
          path: OMiContextRoot + options.path,
          method: options.method,
          headers: {
          Cookie: omiCookies,
            'X-Secure-Modify-Token': secureModifyToken
          }
        };
    if (options.body && options.method !== 'GET') {
      requestOptions.headers['Content-Type'] = 'text/xml';
      requestOptions.headers['Content-Length'] =  Buffer.byteLength(options.body);
    }
    var  result         = '',
        request        = http.request(
          requestOptions, function(res) {

            switch (res.statusCode) {
              case 200:
                // everything is OK, return body request
                res.setEncoding('utf8');
                res.on(
                  'data', function(chunk) {
                    result += chunk;
                  }
                );
                res.on(
                  'end', () => {
                    if (callback instanceof Function) {
                      return callback(null, result);
                    }
                  }
                );
                break;
              case 401:
                // not authorized, authenticate and retry request
                return OMiAuthenticate(
                  function(err) {
                    if (err) {
                      if (callback instanceof Function) {
                        return callback(true);
                      }
                      return;
                    }
                    return OMiRestCall(options, callback);
                  }
                );
                break;
              default:
                // error
                res.on(
                  'data', function(chunk) {
                    OMiBot.logger.info(
                      'Error: unable to send request to OMi ' + requestOptions.path, 'Status: ' + res.statusCode,
                      'Server reply:' + chunk, 'Body:' + options.body
                    );
                    if (callback instanceof Function) {
                      return callback(true);
                    }
                  }
                );
                break;
            }
          }
        );
    request.on(
      'error', function(error) {
        OMiBot.logger.info(
          'Error: unable to send request to OMi ' + requestOptions.path, 'Message: ' + error,
          'Body:' + options.body
        );
        if (callback instanceof Function) {
          return callback(true);
        }
      }
    );
    if (options.body && options.method !== 'GET') {
      request.write(options.body);
    }
    request.end();
  }

  /* ------------ INIT ------------ */
  if (OMiProtocol === 'https') {
    http = Https;
  }

  /* ------------ CHAT HANDLERS ------------ */

  OMiBot.respond(/omi\s+escalate\s+event\s*(\S*)/i, chatHandlerEscal);

  /* ------------ HTTP SERVER ROUTERS ------------ */
  OMiBot.router.post('/omibot/:channel/event', rawbody, eventHandler);
  OMiBot.router.post('/omibot/:channel/event_change/:id', rawbody, eventChangeHandler);
  OMiBot.router.post('/omibot/:channel/event_change', rawbody, eventHandler);
  OMiBot.router.get('/omibot/:channel', eventConnectHandler);

  OMiAuthenticate();
};
