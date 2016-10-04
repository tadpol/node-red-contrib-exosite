module.exports = function(RED) {
	"use strict";
	var https = require("follow-redirects").https;
	var http = require("follow-redirects").http; // Only for local GMQ connects.
	var urllib = require("url");
	var querystring = require("querystring");
	var fs = require('fs');
	var exec = require('child_process').exec;

	/**********************************************************************/
	var hasGWE = false;
	var hasGMQ = false;
	try {
		fs.statSync("/usr/local/bin/gwe");
		hasGWE = true;
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
	function shttps(opts) {
		if (opts.protocol == 'http:') {
			return http;
		} else {
			return https;
		}
	}

	/**********************************************************************/
	function ExositeConfigureClient(config) {
		RED.nodes.createNode(this,config);
		var cfgNode = this;
		this.productID = config.productID;
		this.serialNumber = config.serialNumber;
		this.connectBy = config.connectBy;

		this.host = function() {
			if (cfgNode.connectBy == "GWE" || cfgNode.connectBy == "GMQ") {
				return "http://localhost:8090";
			} else {
				return 'https://'+cfgNode.productID + ".m2.exosite.com";
			}
		}

		this.configuredOptions = function(node, callback) {
			var Ropts = urllib.parse(cfgNode.host()+'/onep:v1/stack/alias');
			Ropts.headers = {};
			Ropts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
			Ropts.headers['Accept'] = 'application/x-www-form-urlencoded; charset=utf-8';

			if (hasGMQ && cfgNode.connectBy == "GMQ") {
				Ropts.headers['X-Exosite-VMS'] = cfgNode.productID + " " + cfgNode.productID + " " + cfgNode.serialNumber;
				callback(Ropts);

			} else if (cfgNode.credentials.cik != null && cfgNode.credentials.cik != "") {
				Ropts.headers['X-Exosite-CIK'] = cfgNode.credentials.cik;
				callback(Ropts);

			} else if (hasGWE && cfgNode.connectBy == "GWE") {
				node.status({fill:"blue",shape:"ring",text:"activating"});
				node.log("Fetching the GWE CIK");
				exec("/usr/local/bin/gwe --gateway-cik", function(err,stdout,stderr) {
					if (err) {
						RED.log.info("Failed to fetch Gateway's CIK");
						node.status({fill:"red",shape:"ring",text:"Failed to fetch CIK"});
					}
					else {
						try {
							var info = stdout.trim();
							cfgNode.credentials.cik = info;
							Ropts.headers['X-Exosite-CIK'] = cfgNode.credentials.cik;
							node.status({});
							callback(Ropts);
						}
						catch(e) {
							RED.log.info("Failed to parse CIK",stdout.trim());
							node.status({fill:"red",shape:"ring",text:"Failed to parse CIK"});
						}
					}
				});

			} else {
				// Not yet, Need to activate.
				node.status({fill:"blue",shape:"ring",text:"activating"});
				node.log("Going to activate "+cfgNode.productID+"; " + cfgNode.serialNumber);
				var opts = urllib.parse(cfgNode.host()+'/provision/activate')
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
						if (result.statusCode != 200) {
							var msg = {}
							msg.title = 'Activation Error'
							msg.payload = {code: result.statusCode, body: recievedCIK}
							node.error("Failed to activate : " + recievedCIK, msg);
							node.status({fill:"red",shape:"ring",text:recievedCIK});
						} else {
							node.status({});
							cfgNode.credentials.cik = recievedCIK;
							Ropts.headers['X-Exosite-CIK'] = cfgNode.credentials.cik;
							callback(Ropts);
						}
					});
				});
				req.on('error',function(err) {
					var msg = {}
					msg.payload = err;
					node.error("Failed to activate : " + err.toString(), msg);
					node.status({fill:"red",shape:"ring",text:err.code});
				});
				req.write(payload);
				req.end();
			}
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

				//node.log(":=: " + util.inspect(opts, {showHidden:false, depth: null}));
				var req = shttps(opts).request(opts, function(result){
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
			function doRead(opts) {
				node.status({fill:"blue",shape:"dot",text:"reading"});
				opts.method = 'GET';
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

				var req = shttps(opts).request(opts, function(result){
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
			}

			var device = RED.nodes.getNode(config.device);
			if (device) {
				device.configuredOptions(node, doRead);
			} else {
				// Old style
				var opts = urllib.parse('https://'+productID+'m2.exosite.com/onep:v1/stack/alias');
				opts.headers = {};
				opts.headers['X-Exosite-CIK'] = this.credentials.cik;
				opts.headers['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8';
				opts.headers['Accept'] = 'application/x-www-form-urlencoded; charset=utf-8';
				doRead(opts);
			}
		});
	}
	RED.nodes.registerType("exo-read-client", ExositeReadClient, {
		credentials: {
			cik: {type:"password"}
		}
	});

	/**********************************************************************/
	function ExositeWatchClient(config) {
		RED.nodes.createNode(this,config);
		var node = this;
		node.running = true;

		// Setup and watch
		function doRead(opts) {
			opts.method = 'GET';
			opts.headers['Request-Timeout'] = "300000";
			opts.query = config.alias;
			opts.path = opts.path + '?' + config.alias;

			node.req = shttps(opts).request(opts, function(result){
				var allData = '';
				result.on('data', function (chunk) {
					if (allData == '') {
						node.status({fill:"blue",shape:"dot",text:"reading"});
					}
					allData = allData + chunk;
				});
				result.on('end',function() {
					if (allData != '') {
						var msg = {};
						msg.payload = querystring.parse(allData);
						node.send(msg);
					}
					node.status({});
					setTimeout( function() { node.emit("input",{}); }, 100 );
				});
			});
			node.req.on('error',function(err) {
				msg.payload = err.toString();
				msg.statusCode = err.code;
				node.send(msg);
				node.status({fill:"red",shape:"ring",text:err.code});
			});
			node.req.end();
		}

		this.on('input', function(msg) {
			if (node.running) {
				var device = RED.nodes.getNode(config.device);
				if (device) {
					if (device.connectBy != "Direct") {
						node.error("Watch only works with Direct devices.", {});
					} else {
						device.configuredOptions(node, doRead);
					}
				} else {
					node.error("Not configured!", {});
				}
			}
		});

		this.on('close', function(msg) {
			node.running = false;
			if (node.req != nil) {
				node.req.abort();
			}
		});

		// Start it up.
		node.emit("input",{});
	}
	RED.nodes.registerType("exo-watch-client", ExositeWatchClient, {});
}

/*	vim: set cin sw=4 ts=4 : */
