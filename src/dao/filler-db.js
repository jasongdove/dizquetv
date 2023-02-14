"use strict";

const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

class FillerDB {
    constructor(folder, channelService) {
        this.folder = folder;
        this.cache = {};
        this.channelService = channelService;
    }

    async $loadFiller(id) {
        const f = path.join(this.folder, `${id}.json`);
        try {
            return await new Promise((resolve, reject) => {
                fs.readFile(f, (err, data) => {
                    if (err) {
                        return reject(err);
                    }
                    try {
                        const j = JSON.parse(data);
                        j.id = id;
                        resolve(j);
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

    async getFiller(id) {
        if (typeof this.cache[id] === "undefined") {
            this.cache[id] = await this.$loadFiller(id);
        }
        return this.cache[id];
    }

    async saveFiller(id, json) {
        if (typeof id === "undefined") {
            throw Error("Mising filler id");
        }
        const f = path.join(this.folder, `${id}.json`);
        try {
            await new Promise((resolve, reject) => {
                let data;
                try {
                    //id is determined by the file name, not the contents
                    fixup(json);
                    delete json.id;
                    data = JSON.stringify(json);
                } catch (err) {
                    return reject(err);
                }
                fs.writeFile(f, data, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
        } finally {
            delete this.cache[id];
        }
    }

    async createFiller(json) {
        const id = uuidv4();
        fixup(json);
        await this.saveFiller(id, json);
        return id;
    }

    async getFillerChannels(id) {
        const numbers = await this.channelService.getAllChannelNumbers();
        const channels = [];
        await Promise.all(
            numbers.map(async (number) => {
                let ch = await this.channelService.getChannel(number);
                const { name } = ch;
                const { fillerCollections } = ch;
                for (let i = 0; i < fillerCollections.length; i++) {
                    if (fillerCollections[i].id === id) {
                        channels.push({
                            number,
                            name,
                        });
                        break;
                    }
                }
                ch = null;
            }),
        );
        return channels;
    }

    async deleteFiller(id) {
        try {
            const channels = await this.getFillerChannels(id);
            await Promise.all(
                channels.map(async (channel) => {
                    console.log(`Updating channel ${channel.number} , remove filler: ${id}`);
                    const json = await this.channelService.getChannel(channel.number);
                    json.fillerCollections = json.fillerCollections.filter((col) => col.id != id);
                    await this.channelService.saveChannel(channel.number, json);
                }),
            );

            const f = path.join(this.folder, `${id}.json`);
            await new Promise((resolve, reject) => {
                fs.unlink(f, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
        } finally {
            delete this.cache[id];
        }
    }

    async getAllFillerIds() {
        return await new Promise((resolve, reject) => {
            fs.readdir(this.folder, (err, items) => {
                if (err) {
                    return reject(err);
                }
                const fillerIds = [];
                for (let i = 0; i < items.length; i++) {
                    const name = path.basename(items[i]);
                    if (path.extname(name) === ".json") {
                        const id = name.slice(0, -5);
                        fillerIds.push(id);
                    }
                }
                resolve(fillerIds);
            });
        });
    }

    async getAllFillers() {
        const ids = await this.getAllFillerIds();
        return await Promise.all(ids.map(async (c) => this.getFiller(c)));
    }

    async getAllFillersInfo() {
        //returns just name and id
        const fillers = await this.getAllFillers();
        return fillers.map((f) => ({
            id: f.id,
            name: f.name,
            count: f.content.length,
        }));
    }

    async getFillersFromChannel(channel) {
        let f = [];
        if (typeof channel.fillerCollections !== "undefined") {
            f = channel.fillerContent;
        }
        const loadChannelFiller = async (fillerEntry) => {
            let content = [];
            try {
                const filler = await this.getFiller(fillerEntry.id);
                content = filler.content;
            } catch (e) {
                console.error(
                    `Channel #${channel.number} - ${channel.name} references an unattainable filler id: ${fillerEntry.id}`,
                );
            }
            return {
                id: fillerEntry.id,
                content,
                weight: fillerEntry.weight,
                cooldown: fillerEntry.cooldown,
            };
        };
        return await Promise.all(channel.fillerCollections.map(loadChannelFiller));
    }
}

function fixup(json) {
    if (typeof json.content === "undefined") {
        json.content = [];
    }
    if (typeof json.name === "undefined") {
        json.name = "Unnamed Filler";
    }
}

module.exports = FillerDB;
