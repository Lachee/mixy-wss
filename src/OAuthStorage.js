
const { promisify } = require("util");

module.exports = class OAuthStorage {
    constructor(app, redis) {
        this.app    = app;
        this.redis  = redis;
        this.namespace = 'MIXY:oauth';

        this.getAsync = promisify(this.redis.get).bind(this.redis);
    }

    /** Gets the access token */
    async getAccessToken(user_uuid) {
        //Lets get the access
        let access = await this.getAsync(`${this.namespace}:${user_uuid}:mixer:access`);
        if (!access) return false;

        //Return the access
        return access;
    }
}