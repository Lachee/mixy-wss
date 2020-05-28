const Component = require('./Component');
module.exports = class ConstellationComponent extends Component {
    
    initialize() {
        //Create the carnia instance
        this.carnia = new Carina({
            isBot: true,
            queryString: { 'Client-ID': this.app.gameClientId }
        }).open();

        //Subscribe
        this.log("Constellation Initialized");
        this.user = null;

        this.consumer.on('identify', (user) => {
            //Determine if we need to resubscribe
            let requireSubscribe = this.user == null || this.user.id != user.id;

            //Update our own reference, the subscribe
            this.user = user;
            this.subscribe();
        })
    }
        
    deinitialize() {
        this.log("Constellation Deinitialized");
        this.unsubscribe();
    }

    /** Subscribes to Constellation */
    subscribe() {
        this.log('Consumer subscribed');
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

    /** Unsubscribes from Constellation */
    unsubscribe() {
        this.log('Consumer unsubscribed');
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

    /** Costream Update. Seperate function because Co-Streams are cross user, so I cannot unsub all. */
    _carniaCostreamUpdate(data) { this.send('CARNIA_COSTREAM_UPDATE', data); }

}