"use strict";

/******************
 * This module has to follow the program-player contract.
 * Async call to get a stream.
 * * If connection to plex or the file entry fails completely before playing
 *   it rejects the promise and the error is an Error() class.
 * * Otherwise, it returns a stream.
 **/
const PlexTranscoder = require("./plexTranscoder");
const EventEmitter = require("events");
const FFMPEG = require("./ffmpeg");
const constants = require("./constants");

const USED_CLIENTS = {};

class PlexPlayer {
    constructor(context) {
        this.context = context;
        this.ffmpeg = null;
        this.plexTranscoder = null;
        this.killed = false;
        const coreClientId = this.context.db["client-id"].find()[0].clientId;
        let i = 0;
        while (USED_CLIENTS[coreClientId + "-" + i] === true) {
            i++;
        }
        this.clientId = coreClientId + "-" + i;
        USED_CLIENTS[this.clientId] = true;
    }

    cleanUp() {
        USED_CLIENTS[this.clientId] = false;
        this.killed = true;
        if (this.plexTranscoder != null) {
            this.plexTranscoder.stopUpdatingPlex();
            this.plexTranscoder = null;
        }
        if (this.ffmpeg != null) {
            this.ffmpeg.kill();
            this.ffmpeg = null;
        }
    }

    async play(outStream) {
        const { lineupItem } = this.context;
        const { ffmpegSettings } = this.context;
        const { db } = this.context;
        const { channel } = this.context;
        let server = db["plex-servers"].find({ name: lineupItem.serverKey });
        if (server.length == 0) {
            throw Error(`Unable to find server "${lineupItem.serverKey}" specified by program.`);
        }
        server = server[0];
        if (server.uri.endsWith("/")) {
            server.uri = server.uri.slice(0, server.uri.length - 1);
        }

        try {
            const plexSettings = db["plex-settings"].find()[0];
            const plexTranscoder = new PlexTranscoder(this.clientId, server, plexSettings, channel, lineupItem);
            this.plexTranscoder = plexTranscoder;
            const { watermark } = this.context;
            let ffmpeg = new FFMPEG(ffmpegSettings, channel); // Set the transcoder options
            ffmpeg.setAudioOnly(this.context.audioOnly);
            this.ffmpeg = ffmpeg;
            let streamDuration;
            if (typeof lineupItem.streamDuration !== "undefined") {
                if (lineupItem.start + lineupItem.streamDuration + constants.SLACK < lineupItem.duration) {
                    streamDuration = lineupItem.streamDuration / 1000;
                }
            }
            const deinterlace = ffmpegSettings.enableFFMPEGTranscoding; //for now it will always deinterlace when transcoding is enabled but this is sub-optimal

            const stream = await plexTranscoder.getStream(deinterlace);
            if (this.killed) {
                return;
            }

            //let streamStart = (stream.directPlay) ? plexTranscoder.currTimeS : undefined;
            //let streamStart = (stream.directPlay) ? plexTranscoder.currTimeS : lineupItem.start;
            const streamStart = stream.directPlay ? plexTranscoder.currTimeS : undefined;
            const { streamStats } = stream;
            streamStats.duration = lineupItem.streamDuration;

            const emitter = new EventEmitter();
            //setTimeout( () => {
            let ff = await ffmpeg.spawnStream(
                stream.directPlay,
                stream.streamUrl,
                stream.streamStats,
                streamStart,
                streamDuration,
                watermark,
                lineupItem,
            ); // Spawn the ffmpeg process
            ff.pipe(outStream, { end: false });
            //}, 100);
            plexTranscoder.startUpdatingPlex();

            ffmpeg.on("end", () => {
                emitter.emit("end");
            });
            ffmpeg.on("close", () => {
                emitter.emit("close");
            });
            ffmpeg.on("error", async (err) => {
                console.log("Replacing failed stream with error stream");
                ff.unpipe(outStream);
                ffmpeg.removeAllListeners("data");
                ffmpeg.removeAllListeners("end");
                ffmpeg.removeAllListeners("error");
                ffmpeg.removeAllListeners("close");
                ffmpeg = new FFMPEG(ffmpegSettings, channel); // Set the transcoder options
                ffmpeg.setAudioOnly(this.context.audioOnly);
                ffmpeg.on("close", () => {
                    emitter.emit("close");
                });
                ffmpeg.on("end", () => {
                    emitter.emit("end");
                });
                ffmpeg.on("error", (err) => {
                    emitter.emit("error", err);
                });

                ff = await ffmpeg.spawnError("oops", "oops", Math.min(streamStats.duration, 60000));
                ff.pipe(outStream);

                emitter.emit("error", err);
            });
            return emitter;
        } catch (err) {
            return Error("Error when playing plex program: " + JSON.stringify(err));
        }
    }
}

module.exports = PlexPlayer;
