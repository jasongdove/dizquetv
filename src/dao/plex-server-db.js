// hmnn this is more of a "PlexServerService"...
const ICON_REGEX = /https?:\/\/.*(\/library\/metadata\/\d+\/thumb\/\d+).X-Plex-Token=.*/;

const ICON_FIELDS = ["icon", "showIcon", "seasonIcon", "episodeIcon"];

// DB is a misnomer here, this is closer to a service
export default class PlexServerDB {
    constructor(channelService, fillerDB, showDB, db) {
        this.channelService = channelService;
        this.db = db;

        this.fillerDB = fillerDB;
        this.showDB = showDB;
    }

    async fixupAllChannels(name, newServer) {
        const channelNumbers = await this.channelService.getAllChannelNumbers();
        const report = await Promise.all(
            channelNumbers.map(async (i) => {
                const channel = await this.channelService.getChannel(i);
                const channelReport = {
                    channelNumber: channel.number,
                    channelName: channel.name,
                    destroyedPrograms: 0,
                    modifiedPrograms: 0,
                };
                this.fixupProgramArray(channel.programs, name, newServer, channelReport);
                // if fallback became offline, remove it
                if (
                    typeof channel.fallback !== "undefined" &&
                    channel.fallback.length > 0 &&
                    channel.fallback[0].isOffline
                ) {
                    channel.fallback = [];
                    if (channel.offlineMode != "pic") {
                        channel.offlineMode = "pic";
                        channel.offlinePicture = `http://localhost:${process.env.PORT}/images/generic-offline-screen.png`;
                    }
                }
                this.fixupProgramArray(channel.fallback, name, newServer, channelReport);
                await this.channelService.saveChannel(i, channel);
                return channelReport;
            }),
        );

        return report;
    }

    async fixupAllFillers(name, newServer) {
        const fillers = await this.fillerDB.getAllFillers();
        const report = await Promise.all(
            fillers.map(async (filler) => {
                const fillerReport = {
                    channelNumber: "--",
                    channelName: filler.name + " (filler)",
                    destroyedPrograms: 0,
                    modifiedPrograms: 0,
                };
                this.fixupProgramArray(filler.content, name, newServer, fillerReport);
                filler.content = this.removeOffline(filler.content);

                await this.fillerDB.saveFiller(filler.id, filler);

                return fillerReport;
            }),
        );
        return report;
    }

    async fixupAllShows(name, newServer) {
        const shows = await this.showDB.getAllShows();
        const report = await Promise.all(
            shows.map(async (show) => {
                const showReport = {
                    channelNumber: "--",
                    channelName: show.name + " (custom show)",
                    destroyedPrograms: 0,
                    modifiedPrograms: 0,
                };
                this.fixupProgramArray(show.content, name, newServer, showReport);
                show.content = this.removeOffline(show.content);

                await this.showDB.saveShow(show.id, show);

                return showReport;
            }),
        );
        return report;
    }

    removeOffline(progs) {
        if (typeof progs === "undefined") {
            return progs;
        }
        return progs.filter((p) => {
            return true !== p.isOffline;
        });
    }

    async fixupEveryProgramHolders(serverName, newServer) {
        const reports = await Promise.all([
            this.fixupAllChannels(serverName, newServer),
            this.fixupAllFillers(serverName, newServer),
            this.fixupAllShows(serverName, newServer),
        ]);
        const report = [];
        reports.forEach((r) =>
            r.forEach((r2) => {
                report.push(r2);
            }),
        );
        return report;
    }

    async deleteServer(name) {
        const report = await this.fixupEveryProgramHolders(name, null);
        this.db["plex-servers"].remove({ name: name });
        return report;
    }

    doesNameExist(name) {
        return this.db["plex-servers"].find({ name: name }).length > 0;
    }

    async updateServer(server) {
        const name = server.name;
        if (typeof name === "undefined") {
            throw Error("Missing server name from request");
        }
        let s = this.db["plex-servers"].find({ name: name });
        if (s.length != 1) {
            throw Error("Server doesn't exist.");
        }
        s = s[0];
        let arGuide = server.arGuide;
        if (typeof arGuide === "undefined") {
            arGuide = false;
        }
        let arChannels = server.arChannels;
        if (typeof arChannels === "undefined") {
            arChannels = false;
        }
        const newServer = {
            name: s.name,
            uri: server.uri,
            accessToken: server.accessToken,
            arGuide: arGuide,
            arChannels: arChannels,
            index: s.index,
        };
        this.normalizeServer(newServer);

        const report = await this.fixupEveryProgramHolders(name, newServer);

        this.db["plex-servers"].update({ _id: s._id }, newServer);
        return report;
    }

    async addServer(server) {
        let name = server.name;
        if (typeof name === "undefined") {
            name = "plex";
        }
        let i = 2;
        const prefix = name;
        let resultName = name;
        while (this.doesNameExist(resultName)) {
            resultName = `${prefix}${i}`;
            i += 1;
        }
        name = resultName;
        let arGuide = server.arGuide;
        if (typeof arGuide === "undefined") {
            arGuide = false;
        }
        let arChannels = server.arGuide;
        if (typeof arChannels === "undefined") {
            arChannels = false;
        }
        const index = this.db["plex-servers"].find({}).length;

        const newServer = {
            name: name,
            uri: server.uri,
            accessToken: server.accessToken,
            arGuide: arGuide,
            arChannels: arChannels,
            index: index,
        };
        this.normalizeServer(newServer);
        this.db["plex-servers"].save(newServer);
    }

    fixupProgramArray(arr, serverName, newServer, channelReport) {
        if (typeof arr !== "undefined") {
            for (let i = 0; i < arr.length; i++) {
                arr[i] = this.fixupProgram(arr[i], serverName, newServer, channelReport);
            }
        }
    }
    fixupProgram(program, serverName, newServer, channelReport) {
        if (program.serverKey === serverName && newServer == null) {
            channelReport.destroyedPrograms += 1;
            return {
                isOffline: true,
                duration: program.duration,
            };
        } else if (program.serverKey === serverName) {
            let modified = false;
            ICON_FIELDS.forEach((field) => {
                if (
                    typeof program[field] === "string" &&
                    program[field].includes("/library/metadata") &&
                    program[field].includes("X-Plex-Token")
                ) {
                    const m = program[field].match(ICON_REGEX);
                    if (m.length == 2) {
                        const lib = m[1];
                        const newUri = `${newServer.uri}${lib}?X-Plex-Token=${newServer.accessToken}`;
                        program[field] = newUri;
                        modified = true;
                    }
                }
            });
            if (modified) {
                channelReport.modifiedPrograms += 1;
            }
        }
        return program;
    }

    normalizeServer(server) {
        while (server.uri.endsWith("/")) {
            server.uri = server.uri.slice(0, -1);
        }
    }
}
