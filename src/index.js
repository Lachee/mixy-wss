const HOST = "http://mx.local:81/";
const TTL_ACTIVE        = 60 * 60 * 24;
const TTL_ACTIVE_CHECK  = 60 * 10;
const WSS_PORT = 6499;

const { v1: Uuid, v5: Uuidv5 }  = require('uuid');
const WebSocket                 = require('ws');
const NodeCache                 = require('node-cache');
const Consumer                  = require('./consumer');
const OAuthStorage              = require('./OAuthStorage');
const fetch                     = require('node-fetch');
const Redis                     = require('redis');
const redis                     = Redis.createClient();


const App = {


    init() {
        this.baseUrl = HOST;

        this.oauthStorage = new OAuthStorage(this, redis);

        this.consumers = new NodeCache({stdTTL: TTL_ACTIVE, checkperiod: TTL_ACTIVE_CHECK, useClones: false, deleteOnExpire: true });
        this.consumers.on('expired', (key, value) => { 
            console.log("Consumer Expired", value.uuid); 
            value.close('Exceeded maxium active time'); 
        });

        this.wss = new WebSocket.Server({ port: WSS_PORT }),
        this.wss.on('connection', (ws) => {
            var uuid = Uuid();

            var consumer = new Consumer(this, uuid, ws);
            this.consumers.set(uuid, consumer);
            this.consumers.ttl(uuid, TTL_ACTIVE);

            //Remove the UUID on close
            consumer.on('close', () => {
                console.log("Removed", uuid);
                this.consumers.del(uuid);
            });

            //Initialize
            consumer.init();
        });
    },

    /** Validates the JWT tokens */
    async validateAuthenticationAsync(token) {
        var response = await fetch(this.baseUrl + "api/validate/" + token);
        if (response.status != 200) {
            console.error("validation failed!");
            return false;
        }
        
        let json = await response.json();
        return json.data;
    },

    /** Refreshes a oAuthToken */
    async refreshAuthenticationAsync(token) {
        let response = await fetch(this.baseUrl + `authentication/${token}/refresh`, { method: 'POST' });
        return response.status ==  200;
    }

}

App.init();