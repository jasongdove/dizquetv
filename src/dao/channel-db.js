import { join, basename, extname } from "path";
import { readFile, writeFile, writeFileSync, unlink, readdir } from "fs";

class ChannelDB {
    constructor(folder) {
        this.folder = folder;
    }

    async getChannel(number) {
        const f = join(this.folder, `${number}.json`);
        try {
            return await new Promise((resolve, reject) => {
                readFile(f, (err, data) => {
                    if (err) {
                        return reject(err);
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    async saveChannel(number, json) {
        await this.validateChannelJson(number, json);
        const f = join(this.folder, `${json.number}.json`);
        return await new Promise((resolve, reject) => {
            let data = undefined;
            try {
                data = JSON.stringify(json);
            } catch (err) {
                return reject(err);
            }
            writeFile(f, data, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    saveChannelSync(number, json) {
        this.validateChannelJson(number, json);

        const data = JSON.stringify(json);
        const f = join(this.folder, `${json.number}.json`);
        writeFileSync(f, data);
    }

    validateChannelJson(number, json) {
        json.number = number;
        if (typeof json.number === "undefined") {
            throw Error("Expected a channel.number");
        }
        if (typeof json.number === "string") {
            try {
                json.number = parseInt(json.number);
            } catch (err) {
                console.error("Error parsing channel number.", err);
            }
        }
        if (isNaN(json.number)) {
            throw Error("channel.number must be a integer");
        }
    }

    async deleteChannel(number) {
        const f = join(this.folder, `${number}.json`);
        await new Promise((resolve, reject) => {
            unlink(f, function (err) {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    async getAllChannelNumbers() {
        return await new Promise((resolve, reject) => {
            readdir(this.folder, function (err, items) {
                if (err) {
                    return reject(err);
                }
                const channelNumbers = [];
                for (let i = 0; i < items.length; i++) {
                    const name = basename(items[i]);
                    if (extname(name) === ".json") {
                        const numberStr = name.slice(0, -5);
                        if (!isNaN(numberStr)) {
                            channelNumbers.push(parseInt(numberStr));
                        }
                    }
                }
                resolve(channelNumbers);
            });
        });
    }

    async getAllChannels() {
        const numbers = await this.getAllChannelNumbers();
        return await Promise.all(numbers.map(async (c) => this.getChannel(c)));
    }
}

export default ChannelDB;
