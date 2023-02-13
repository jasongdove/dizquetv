import { join, basename, extname } from "path";
import { v4 as uuidv4 } from "uuid";
import { readFile, writeFile, unlink, readdir } from "fs";

class CustomShowDB {
    constructor(folder) {
        this.folder = folder;
    }

    async $loadShow(id) {
        const f = join(this.folder, `${id}.json`);
        try {
            return await new Promise((resolve, reject) => {
                readFile(f, (err, data) => {
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

    async getShow(id) {
        return await this.$loadShow(id);
    }

    async saveShow(id, json) {
        if (typeof id === "undefined") {
            throw Error("Mising custom show id");
        }
        const f = join(this.folder, `${id}.json`);

        await new Promise((resolve, reject) => {
            let data = undefined;
            try {
                // id is determined by the file name, not the contents
                fixup(json);
                delete json.id;
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

    async createShow(json) {
        const id = uuidv4();
        fixup(json);
        await this.saveShow(id, json);
        return id;
    }

    async deleteShow(id) {
        const f = join(this.folder, `${id}.json`);
        await new Promise((resolve, reject) => {
            unlink(f, function (err) {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    async getAllShowIds() {
        return await new Promise((resolve, reject) => {
            readdir(this.folder, function (err, items) {
                if (err) {
                    return reject(err);
                }
                const fillerIds = [];
                for (let i = 0; i < items.length; i++) {
                    const name = basename(items[i]);
                    if (extname(name) === ".json") {
                        const id = name.slice(0, -5);
                        fillerIds.push(id);
                    }
                }
                resolve(fillerIds);
            });
        });
    }

    async getAllShows() {
        const ids = await this.getAllShowIds();
        return await Promise.all(ids.map(async (c) => this.getShow(c)));
    }

    async getAllShowsInfo() {
        // returns just name and id
        const shows = await this.getAllShows();
        return shows.map((f) => {
            return {
                id: f.id,
                name: f.name,
                count: f.content.length,
            };
        });
    }
}

function fixup(json) {
    if (typeof json.content === "undefined") {
        json.content = [];
    }
    if (typeof json.name === "undefined") {
        json.name = "Unnamed Show";
    }
}

export default CustomShowDB;
