module.exports = function(RED) {
	"use strict";
	var https = require("follow-redirects").https;
	var urllib = require("url");
	var querystring = require("querystring");

	/**********************************************************************/
	function ExositeConfigureClient(config) {
		RED.nodes.createNode(this,config);
		this.productID = config.productID;
		this.serialNumber = config.serialNumber;

		this.cik = function() {}

		// TODO: if no CIK, then call POST /provision/activate
		/*
		 * There are three kinds
		 * - productID+SN to Exosite.
		 * - productID+SN to GMQ (localhost)
		 * - aliases on GWE device.
		 */
	}

	RED.nodes.registerType("exo-config-client", ExositeConfigureClient, {
		credentials: {
			cik: {type:"password"}
		}
	});

	/**********************************************************************/
	function ExositeWriteClient(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		this.on('input', function(msg) {
			node.status({fill:"blue",shape:"dot",text:"writing"});

			var productID = "";
			var device = RED.nodes.getNode(config.device);
			if (device) {
				this.credentials.cik = device.credentials.cik;
				productID = device.productID + ".";
			}

			var opts = urllib.parse('https://'+productID+'m2.exosite.com/onep:v1/stack/alias');
			opts.method = 'POST';
			opts.headers = {};
			opts.headers['X-Exosite-CIK'] = this.credentials.cik;
			opts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';

			var payload;
			if (typeof(msg.payload) === 'string') {
				if (config.alias != null && config.alias != '') {
					var f={};
					f[config.alias] = msg.payload;
					payload = querystring.stringify(f);
				} else {
					payload = msg.payload;
				}
			} else if (typeof msg.payload === "number") {
				if (config.alias != null && config.alias != '') {
					var f={};
					f[config.alias] = msg.payload+"";
					payload = querystring.stringify(f);
				} else {
					// this will fail.
					payload = msg.payload+"";
					// FIXME: log an error (status will be updated when call errors)
				}
			} else {
				payload = querystring.stringify(msg.payload);
			}
			opts.headers['content-length'] = Buffer.byteLength(payload);

			var req = https.request(opts, function(result){
				result.on('data', function (chunk) {});
				result.on('end',function() {
					node.status({});
				});
			});
			req.on('error',function(err) {
				msg.payload = err.toString();
				msg.statusCode = err.code;
				node.send(msg);
				node.status({fill:"red",shape:"ring",text:err.code});
			});
			req.write(payload);
			req.end();
		});
	}
	RED.nodes.registerType("exo-write-client", ExositeWriteClient, {
		credentials: {
			cik: {type:"password"}
		}
	});

	/**********************************************************************/
	function ExositeReadClient(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		this.on('input', function(msg) {
			node.status({fill:"blue",shape:"dot",text:"reading"});

			var productID = "";
			var device = RED.nodes.getNode(config.device);
			if (device) {
				this.credentials.cik = device.credentials.cik;
				productID = device.productID + ".";
			}

			var opts = urllib.parse('https://'+productID+'m2.exosite.com/onep:v1/stack/alias');
			opts.method = 'GET';
			opts.headers = {};
			opts.headers['X-Exosite-CIK'] = this.credentials.cik;
			opts.headers['Accept'] = 'application/x-www-form-urlencoded; charset=utf-8';

			var payload;
			if (typeof(msg.payload) === 'string' || typeof msg.payload === "number") {
				payload = msg.payload + '';
			} else {
				if ( msg.payload.length ) {
					payload = msg.payload;
				} else {
					payload = [];
					for (var key in msg.payload) {
						payload.push(key);
					}
				}
				payload = payload.join('&');
			}
			opts.query = payload;
			opts.path = opts.path + '?' + payload;

			//node.log(JSON.stringify(opts));
			var req = https.request(opts, function(result){
				var allData = '';
				result.on('data', function (chunk) {
					allData = allData + chunk;
				});
				result.on('end',function() {
					msg.payload = querystring.parse(allData);
					node.send(msg);
					node.status({});
				});
			});
			req.on('error',function(err) {
				msg.payload = err.toString();
				msg.statusCode = err.code;
				node.send(msg);
				node.status({fill:"red",shape:"ring",text:err.code});
			});
			req.end();
		});
	}
	RED.nodes.registerType("exo-read-client", ExositeReadClient, {
		credentials: {
			cik: {type:"password"}
		}
	});

}

/*	vim: set cin sw=4 ts=4 : */
