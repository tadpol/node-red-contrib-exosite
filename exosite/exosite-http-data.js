module.exports = function(RED) {
	"use strict";
	var https = require("follow-redirects").https;
	var urllib = require("url");
	var querystring = require("querystring");
    var fs = require('fs');

	/**********************************************************************/
	var hasGWE = false;
	var hasGMQ = false;
	try {
		fs.statSync("/usr/local/bin/gwe");
		hasGWE = true;
		// TODO: call `gwe --gateway-cik` ?here or in config?
	} catch(err) {
		hasGWE = false;
	}
	if (hasGWE) {
		try {
			fs.statSync("/usr/local/bin/gmq");
			hasGMQ = true;
		} catch(err) {
			hasGMQ = false;
		}
	}

    RED.httpAdmin.get('/exosite-config-features',
		RED.auth.needsPermission('exosite-config-features.read'),
		function(req,res) {
        res.json({"GWE":hasGWE, "GMQ":hasGMQ});
    });

	/**********************************************************************/
	function ExositeConfigureClient(config) {
		RED.nodes.createNode(this,config);
		var cfgNode = this;
		this.productID = config.productID;
		this.serialNumber = config.serialNumber;
		this.connectBy = config.connectBy;

		this.host = function() {
			if (cfgNode.connectBy == "GWE" || cfgNode.connectBy == "GMQ") {
				return "localhost:8090";
			} else {
				return cfgNode.productID + ".m2.exosite.com";
			}
		}

		this.configuredOptions = function(node, callback) {
			var Ropts = urllib.parse('https://'+cfgNode.host()+'/onep:v1/stack/alias');
			Ropts.headers = {};
			Ropts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
			if (cfgNode.credentials.cik != null && cfgNode.credentials.cik != "") {
				Ropts.headers['X-Exosite-CIK'] = cfgNode.credentials.cik;

				callback(Ropts);
				return;
			}
			// Not yet, Need to activate.
			node.status({fill:"blue",shape:"ring",text:"activating"});
			node.log("Going to activate "+cfgNode.productID+"; " + cfgNode.serialNumber);
			var opts = urllib.parse('https://'+cfgNode.host()+'/provision/activate')
			opts.method = 'POST';
			opts.headers = {};
			opts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
			var payload = querystring.stringify({
				vendor: cfgNode.productID,
				model: cfgNode.productID,
				sn: cfgNode.serialNumber
			});
			opts.headers['content-length'] = Buffer.byteLength(payload);

			var recievedCIK = "";
			var req = https.request(opts, function(result){
				result.on('data', function (chunk) {
					recievedCIK = recievedCIK + chunk;
				});
				result.on('end',function() {
					node.status({});
					cfgNode.credentials.cik = recievedCIK;
					Ropts.headers['X-Exosite-CIK'] = cfgNode.credentials.cik;
					callback(Ropts);
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
		}

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
			function doWrite(opts) {
				node.status({fill:"blue",shape:"dot",text:"writing"});
				opts.method = 'POST';
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
			}


			var device = RED.nodes.getNode(config.device);
			if (device) {
				device.configuredOptions(node, doWrite);
			} else {
				// Old style
				var opts = urllib.parse('https://'+productID+'m2.exosite.com/onep:v1/stack/alias');
				opts.headers = {};
				opts.headers['X-Exosite-CIK'] = this.credentials.cik;
				opts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
				doWrite(opts);
			}

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
				this.credentials.cik = device.credentials.cik; // XXX
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

	/**********************************************************************/
	// TODO: add 'exo watch' which does a Long-Poll on a device & aliases.
}

/*	vim: set cin sw=4 ts=4 : */
