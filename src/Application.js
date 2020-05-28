const { v1: Uuid, v5: Uuidv5 }  = require('uuid');
const WebSocket                 = require('ws');
const NodeCache                 = require('node-cache');
const Client                    = require('./Client');
const OAuthStorage              = require('./OAuthStorage');
const fetch                     = require('node-fetch');
const Redis                     = require('redis');

/** Websocket Server Application */
module.exports = class Application {
    
    constructor(config) {
        //Prepare config defaults
        config.defaults({
            'host':             'http://mx.local:81/',
            'port':             6499,
            'ttl_active':       60 * 60 * 24,
            'ttl_active_check': 60 * 10,
        });

        //Set the config
        this.config = config;
    }

    /** Setups the application and runs it */
    initialize() {

        console.log("Initializing App");

        //Create Redis and OAuth Storage
        this.redis = Redis.createClient();
        this.oauthStorage = new OAuthStorage(this, this.redis);

        //Create consumer
        this.consumers = new NodeCache({stdTTL: this.config.get('ttl_active'), checkperiod: this.config.get('ttl_active_check'), useClones: false, deleteOnExpire: true });
        this.consumers.on('expired', (key, value) => { 
            console.log("Consumer Expired", value.uuid); 
            value.close('Exceeded maxium active time'); 
        });

        //Create websocket
        this.wss = new WebSocket.Server({ port: this.config.get('port') }),
        this.wss.on('connection', (connection) => {
            var uuid = Uuid();
            console.log("new connection", uuid);

            var consumer = new Client(this, uuid, connection);
            this.consumers.set(uuid, consumer);
            this.consumers.ttl(uuid, this.config.get('ttl_active'));

            //Remove the UUID on close
            consumer.on('close', () => {
                console.log("Removed", uuid);
                this.consumers.del(uuid);
            });

            //Initialize
            consumer.start();
        });
    }

    
    /** Validates the JWT tokens */
    async validateAuthenticationAsync(token) {
        var response = await fetch(this.config.get('host') + "api/validate/" + token);
        if (response.status != 200) {
            console.error("validation failed!");
            return false;
        }
        
        let json = await response.json();
        return json.data;
    }

    /** Refreshes a oAuthToken */
    async refreshAuthenticationAsync(token) {
        let response = await fetch(this.config.get('host') + `authentication/${token}/refresh`, { method: 'POST' });
        return response.status ==  200;
    }
}