const path = require('path');
const { v4: uuidv4 } = require('uuid');
let fs = require('fs');
 
class CustomShowDB {

    constructor(folder) {
        this.folder = folder;
    }

    async $loadShow(id) {
        let f = path.join(this.folder, `${id}.json` );
        try {
            return await new Promise( (resolve, reject) => {
                fs.readFile(f, (err, data) => {
                    if (err) {
                        return reject(err);
                    }
                    try {
                        let j = JSON.parse(data);
                        j.id = id;
                        resolve(j);
                    } catch (err) {
                        reject(err);
                    }
                })
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
        if (typeof(id) === 'undefined') {
            throw Error("Mising custom show id");
        }
        let f = path.join(this.folder, `${id}.json` );

            await new Promise( (resolve, reject) => {
                let data = undefined;
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
    }

    async createShow(json) {
        let id = uuidv4();
        fixup(json);
        await this.saveShow(id, json);
        return id;
    }

    async deleteShow(id) {
            let f = path.join(this.folder, `${id}.json` );
            await new Promise( (resolve, reject) => {
                fs.unlink(f, function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
    }

    
    async getAllShowIds() {
        return await new Promise( (resolve, reject) => {
            fs.readdir(this.folder, function(err, items) {
                if (err) {
                    return reject(err);
                }
                let fillerIds = [];
                for (let i = 0; i < items.length; i++) {
                    let name = path.basename( items[i] );
                    if (path.extname(name) === '.json') {
                        let id = name.slice(0, -5);
                        fillerIds.push(id);
                    }
                }
                resolve (fillerIds);
            });
        });
    }
    
    async getAllShows() {
        let ids = await this.getAllShowIds();
        return await Promise.all( ids.map( async (c) => this.getShow(c) ) );
    }

    async getAllShowsInfo() {
        //returns just name and id
        let shows = await this.getAllShows();
        return shows.map( (f) =>  {
            return {
                'id'  : f.id,
                'name': f.name,
                'count': f.content.length,
            }
        } );
    }


}

function fixup(json) {
    if (typeof(json.content) === 'undefined') {
        json.content = [];
    }
    if (typeof(json.name) === 'undefined') {
        json.name = "Unnamed Show";
    }
}

module.exports = CustomShowDB;