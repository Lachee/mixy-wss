const CONFIG = 'config.json';

//Load the configuration file
var nconf = require('nconf');
nconf.argv().env().file({ file: CONFIG });

//Pass that to a new application
const Application = require('./Application.js');
const app = new Application(nconf);

//Listen
app.initialize();
nconf.save();