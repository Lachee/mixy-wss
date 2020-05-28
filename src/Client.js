const { ShortCodeExpireError }  = require('@mixer/shortcode-oauth');
const interactive = require('@mixer/interactive-node');
const fetch = require('node-fetch');
const EventEmitter = require('events');
const WebSocket = require('ws');
const Component = require('./components/Component.js');

Carina  = require('carina').Carina;
Carina.WebSocket = WebSocket;
interactive.setWebSocket(WebSocket);

module.exports = class Client extends EventEmitter {
    constructor(app, uuid, ws) {
        super();
        this.app = app;
        this.uuid = uuid;
        this.ws = ws;
        
        this.authetnicationToken = null;
        this.authentication = null;
        this.accessToken = null;
        this.nonce = 0;

        this.components = [];

        this.gameClientId = '8f1f2333d089d0098efb4c1b2599b54e1a696ffc5850f121';
        this.gameVersionId = 461588;
    }

    /** Called when a connection is first made */
    start() {
        const self = this;
        this.ws.on('message', message => {
            let blob = JSON.parse(message);
            switch(blob.e) {

                //Auth system message
                case "HANDSHAKE":
                    //Authenticate the token
                    self.log("Handshake");
                    self.app.validateAuthenticationAsync(blob.d.token).then((authentication) => {

                        //Store the authenticated shit
                        self.authetnicationToken = blob.d.token;
                        self.authentication = authentication;

                        //If we are valid, then login
                        // We will catch if we failed so we can close the connection
                        self.login().then((authed) => {
                            if (!authed) {
                                self.emit("deauthenticated");
                                self.close("deauthenticated");
                            }

                            //Now lets just say hello
                            if (self.validate()) {
                                self.gameClientId   = blob.d.gameClientId || self.gameClientId;
                                self.gameVersionId  = blob.d.gameVersionId || self.gameVersionId;
                                self.initialize(blob.d.components || []);
                            }
                        });
                    });
                    break;

                //Anything else we will emit back so the components can subscribe to it
                default:
                    if (!self.validate()) return;
                    this.emit(e, blob.d);
                    break;
            }
        });

        this.ws.on('close', reason => {
            self.close(reason);
        });
    }

    /** Called once a connection is established and ready to go */
    initialize(components = []) {
        const self = this;

        console.log("Initializing Client", this.uuid);
        self.send("INIT", { a: this.authentication, at: this.accessToken });

        //Get the identify ready for the user
        this.mixer('GET', '/users/current').then(user => {
            this.setUser(user);
        });

        //Get all the components
        for(let i in components) {
            let name = components[i];
            if (Component.available[name]) {
                this.log("component: ", name);
                let Class = require(Component.available[name]);
                this.components.push(new Class(this));
            } else {
                console.error(this.uuid, "component missing: ", name);
            }
        }

        //There is no components available, so abort
        if (this.components.length == 0) {
            this.close("No components assigned");
            return;
        }
        
        //Tell all the components to init
        this.components.forEach(c => c.initialize());

        /*
        //Create the mixer client
        console.log("Creating a new game client");
        this.mixer = new interactive.GameClient();
        this.mixer.on('error', e => { console.error("mixplay error", self.uuid, e); self.close('Mixplay error'); });
        this.mixer.on('close', () => { self.close('Mixer close'); });

        this.mixer.open({
            authToken: self.accessToken,
            versionId: self.gameVersionId
        }).then(() => {
            console.log("consumer ready for mixplay", self.uuid);
            self.send('READY');
            return self.mixer.ready(true);
        }).catch(e => {
            console.error("Mixer open failure", self.uuid, e);
            self.close('Mixer open failed');
        });
        */
    }

    /** Sets the Mixer User Object */
    setUser(user) {
        this.user = user;
        this.user = user;
        this.emit('identify', this.user);
        this.send('IDENTIFY', this.user);
    }

    /** Finds the access token */
    async login() {
        //Get the access token from oauth
        this.accessToken = await this.app.oauthStorage.getAccessToken(this.authentication.sub);
        if (!this.accessToken) {
            //We have no access token, so we need to tell the site to refresh the token
            let success = await this.app.refreshAuthenticationAsync(this.authetnicationToken);
            if (success) this.accessToken = await this.app.oauthStorage.getAccessToken(this.authentication.sub);
        }

        let result = this.accessToken !== false && this.accessToken !== null;
        this.emit("login", result);
        return result;
    }

    /** Enforces validation check */
    validate() { 
        if (this.authentication === null) {
            console.error("Connection not authenticated!");
            this.close("not authenticated");
            return false;
        }

        if (this.accessToken == null) {
            console.error("Connection doesn't have an access token");
            this.close("not logged in");
            return false;
        }

        return true;
    }

    /** Closes down the consumer */
    close(reason) {
        this.log("closed", reason);

        if (this.ws) {
            this.ws.send(reason);
            this.ws.close();
            this.ws = null;
        }

        if (this.controller) {
            this.controller.onClose(reason);
        }
        
        //Emit the close
        this.emit("close");
        
        //Tell all the components to init
        if (this.components)
            this.components.forEach(c => c.deinitialize());
    }

    /** Sends an event to the client */
    send(event, payload) {
        var obj = {
            e: event,
            n: this.nonce++,
            d: payload
        };
        this.ws.send(JSON.stringify(obj));
        this.emit(event, obj);
        this.log('send ', obj);
    }

    /** fetches a mixer endpoint */
    async mixer(verb, endpoint, payload = null) {
        let response = await fetch(`https://mixer.com/api/v1${endpoint}`, {
            method: verb,
            body: payload ? JSON.stringify(payload) : null,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        return await response.json();
    }

    /** Logs a message as this client */
    log (message, ...params) {
        console.log(this.uuid, message, ...params);
    }
}