const { ShortCodeExpireError }  = require('@mixer/shortcode-oauth');
const interactive = require('@mixer/interactive-node');
const fetch = require('node-fetch');
const EventEmitter = require('events');
const WebSocket = require('ws');
const Component = require('./components/Component.js');

Carina  = require('carina').Carina;
Carina.WebSocket = WebSocket;
interactive.setWebSocket(WebSocket);

export default class Consumer extends EventEmitter {
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
        this.carnia = new Carina({
            isBot: true,
            queryString: { 'Client-ID': this.gameClientId }
        }).open();
    }

    /** Called when a connection is first made */
    start() {
        const self = this;
        this.ws.on('message', message => {
            console.log(self.uuid, message);
            let blob = JSON.parse(message);
            switch(blob.e) {

                //Auth system message
                case "HANDSHAKE":
                    //Authenticate the token
                    console.log("Handshake for", self.uuid);
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
                            if (self.validate())
                                self.initialize(blob.d.components || []);
                        });
                    });
                    break;

                //Anything else
                default:
                    console.warn("Unkown Event", blob.e);
                    self.validate();
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
        this.mixerResource('GET', '/users/current').then(user => {
            const needs_sub = this.user == null;
            this.user = user;
            this.send('IDENTIFY', this.user);
            if (needs_sub) this.subscribe();
        });

        //Get all the components
        for(let i in components) {
            let name = components[i];
            if (Component.allowedComponents[name]) {
                let Class = require(Component.allowedComponents[name]);
            }
        }

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

        return this.accessToken !== false && this.accessToken !== null;
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
        if (this.ws) {
            this.ws.send(reason);
            this.ws.close();
            this.ws = null;
        }

        if (this.controller) {
            this.controller.onClose(reason);
        }

        this.unsubscribe();

        //Execute the event
        this.emit("close");
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
        console.log("SENT", obj);
    }

    
    /** Subscribes to Constellation */
    subscribe() {
        console.log('consumer subscribed', this.uuid);
        this.carnia.subscribe(`channel:${this.user.channel.id}:update`, data => { 
            //Tell them we updated our channel
            this.send('CHANNEL_UPDATE', data);

            const previousCostreamId = this.user.channel.costreamId;

            //Update our internal channel and resend the idenfity
            this.user.channel = Object.assign(this.user.channel, data);
            this.send('IDENTIFY', this.user);

            //Have we changed? If so, we need to unsub from previous
            if (previousCostreamId != null && previousCostreamId != this.user.channel.costreamId) {
                console.log('consumer left costream', this.uuid, previousCostreamId);
                this.carnia.unsubscribe(`costream:${previousCostreamId}:update`, this._carniaCostreamUpdate);
                this.send('COSTREAM_LEAVE', { id: previousCostreamId });
            }

            //We have a costream, so we need to join one
            if (this.user.channel.costreamId != null) {
                console.log('consumer joined costream', this.uuid, this.user.channel.costreamId);
                this.carnia.subscribe(`costream:${this.user.channel.costreamId}:update`, this._carniaCostreamUpdate);
                this.send('COSTREAM_JOIN');
            }
        });
        
        this.carnia.subscribe(`channel:${this.user.channel.id}:followed`,           data => this.send('CHANNEL_FOLLOWED', data));
        this.carnia.subscribe(`channel:${this.user.channel.id}:hosted`,             data => this.send('CHANNEL_HOSTED', data));
        this.carnia.subscribe(`channel:${this.user.channel.id}:subscribed`,         data => this.send('CHANNEL_SUBSCRIBED', data));
        this.carnia.subscribe(`channel:${this.user.channel.id}:skill`,              data => this.send('CHANNEL_SKILL', data));
        this.carnia.subscribe(`channel:${this.user.channel.id}:patronageUpdate`,    data => this.send('CHANNEL_PATRONAGE_UPDATE', data));
        this.carnia.subscribe(`channel:${this.user.channel.id}:subscriptionGifted`, data => this.send('CHANNEL_SUBSCRIPTION_GIFTED', data));
        this.send('CARNIA_SUBSCRIBED');
        //this.carnia.subscribe(`costream:${this.user.channel.id}:update`, data => this.send('CARNIA_COSTREAM_UPDATE', data));
    }

    /** Costream Update. Seperate function because Co-Streams are cross user, so I cannot unsub all. */
    _carniaCostreamUpdate(data) { this.send('CARNIA_COSTREAM_UPDATE', data); }

    /** Unsubscribes from Constellation */
    unsubscribe() {
        console.log('consumer unsubscribed', this.uuid);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:update`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:followed`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:hosted`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:subscribed`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:skill`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:patronageUpdate`);
        this.carnia.unsubscribe(`channel:${this.user.channel.id}:subscriptionGifted`);

        if (this.user.channel.costreamId != null) 
            this.carnia.unsubscribe(`costream:${this.user.channel.costreamId}:update`, this._carniaCostreamUpdate);

        this.send('CARNIA_UNSUBSCRIBED');
    }

    /** fetches a mixer endpoint */
    async mixerResource(verb, endpoint, payload = null) {
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
}