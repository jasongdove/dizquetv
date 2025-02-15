"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Store files in cache
 *
 * @class FileCacheService
 */
class FileCacheService {
    constructor(cachePath) {
        this.cachePath = cachePath;
        this.cache = {};
    }

    /**
     * `save` a file on cache folder
     *
     * @param {string} fullFilePath
     * @param {*} data
     * @returns {promise}
     * @memberof CacheService
     */
    setCache(fullFilePath, data) {
        return new Promise((resolve, reject) => {
            try {
                const file = fs.createWriteStream(path.join(this.cachePath, fullFilePath));
                file.write(data, (err) => {
                    if (err) {
                        throw Error("Can't save file: ", err);
                    } else {
                        this.cache[fullFilePath] = data;
                        resolve(true);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * `get` a File from cache folder
     *
     * @param {string} fullFilePath
     * @returns {promise} `Resolve` with file content, `Reject` with false
     * @memberof CacheService
     */
    getCache(fullFilePath) {
        return new Promise((resolve, reject) => {
            try {
                if (fullFilePath in this.cache) {
                    resolve(this.cache[fullFilePath]);
                } else {
                    fs.readFile(path.join(this.cachePath, fullFilePath), "utf8", (err, data) => {
                        if (err) {
                            resolve(false);
                        }
                        resolve(data);
                    });
                }
            } catch (error) {
                resolve(false);
                throw Error("Can't get file", error);
            }
        });
    }

    /**
     * `delete` a File from cache folder
     *
     * @param {string} fullFilePath
     * @returns {promise}
     * @memberof CacheService
     */
    deleteCache(fullFilePath) {
        return new Promise((resolve, reject) => {
            try {
                const thePath = path.join(this.cachePath, fullFilePath);
                if (!fs.existsSync(thePath)) {
                    return resolve(true);
                }
                fs.unlinkSync(thePath, (err) => {
                    if (err) {
                        throw Error("Can't save file: ", err);
                    } else {
                        delete this.cache[fullFilePath];
                        resolve(true);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = FileCacheService;
