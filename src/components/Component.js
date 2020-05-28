module.exports = class Component {
    static available = {
        'Constellation': './components/ConstellationComponent.js',
        'Interactive':   './components/InterativeComponent.js',
        'R6Siege':      './components/R6SiegeComponent.js',
    };

    constructor(consumer) {
        //Prepare the references
        this.consumer   = consumer;
        this.app        = consumer.app;        
    }

    initialize() { }
    deinitialize() {}

    /** Sends an event to the consumer */
    send(event, payload) {
        this.consumer.send(event, payload);
    }

    /** Logs a message */
    log (message, ...params){
        this.consumer.log(message, ...params);
    }

    
}