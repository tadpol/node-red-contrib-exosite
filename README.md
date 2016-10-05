# node-red-node-exosite

A node-red node that accesses devices on [Exosite's Murano
platform](http://exosite.com/).

It uses the [HTTP Data API](http://docs.exosite.com/murano/products/device_api/http/)
to read, write, or watch aliases on a device.

## Device config

The exosite nodes are configured to talk to a device instance inside Murano.  This
instance has a set of aliases that descibe the points where data can be read or
wrote.  Each device instance is defined by a product ID and serial number.

If node-red is running on a machine that also has [Gateway Engine](https://gateway-engine.exosite.io/index.html) (GWE)
installed, you can select 'GWE' to access the Gateway Engine's device instance.

A device instance in Murano needs to be in the 'notactivated' state so that it can
be activated by the exosite node-red node.  This happens when you create a new
device in Murano.

