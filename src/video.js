import { Router } from "express";
import { generateChannelContext, createLineup } from "./helperFuncs";
import FFMPEG from "./ffmpeg";
import FFMPEG_TEXT from "./ffmpegText";
import { SLACK, START_CHANNEL_GRACE_PERIOD, CHANNEL_STOP_SHIELD, FORGETFULNESS_BUFFER } from "./constants";
import { existsSync } from "fs";
import ProgramPlayer from "./program-player";
import { getCurrentLineupItem, recordPlayback, clearPlayback } from "./channel-cache";
import wereThereTooManyAttempts from "./throttler";

export const router = video;

let StreamCount = 0;

let stopPlayback = false;

export async function shutdown() {
    stopPlayback = true;
}

function video(channelService, fillerDB, db, programmingService, activeChannelService) {
    const router = Router();

    router.get("/setup", (req, res) => {
        const ffmpegSettings = db["ffmpeg-settings"].find()[0];
        // Check if ffmpeg path is valid
        if (!existsSync(ffmpegSettings.ffmpegPath)) {
            res.status(500).send("FFMPEG path is invalid. The file (executable) doesn't exist.");
            console.error("The FFMPEG Path is invalid. Please check your configuration.");
            return;
        }

        console.log(`\r\nStream starting. Channel: 1 (dizqueTV)`);

        const ffmpeg = new FFMPEG_TEXT(
            ffmpegSettings,
            "dizqueTV (No Channels Configured)",
            "Configure your channels using the dizqueTV Web UI",
        );

        ffmpeg.on("data", (data) => {
            res.write(data);
        });

        ffmpeg.on("error", (err) => {
            console.error("FFMPEG ERROR", err);
            res.status(500).send("FFMPEG ERROR");
            return;
        });
        ffmpeg.on("close", () => {
            res.end();
        });

        res.on("close", () => {
            // on HTTP close, kill ffmpeg
            ffmpeg.kill();
            console.log(`\r\nStream ended. Channel: 1 (dizqueTV)`);
        });
    });
    // Continuously stream video to client. Leverage ffmpeg concat for piecing together videos
    const concat = async (req, res, audioOnly) => {
        if (stopPlayback) {
            res.status(503).send("Server is shutting down.");
            return;
        }

        // Check if channel queried is valid
        if (typeof req.query.channel === "undefined") {
            res.status(500).send("No Channel Specified");
            return;
        }
        const number = parseInt(req.query.channel, 10);
        const channel = await channelService.getChannel(number);
        if (channel == null) {
            res.status(500).send("Channel doesn't exist");
            return;
        }

        const ffmpegSettings = db["ffmpeg-settings"].find()[0];

        // Check if ffmpeg path is valid
        if (!existsSync(ffmpegSettings.ffmpegPath)) {
            res.status(500).send("FFMPEG path is invalid. The file (executable) doesn't exist.");
            console.error("The FFMPEG Path is invalid. Please check your configuration.");
            return;
        }

        res.writeHead(200, {
            "Content-Type": "video/mp2t",
        });

        console.log(`\r\nStream starting. Channel: ${channel.number} (${channel.name})`);

        const ffmpeg = new FFMPEG(ffmpegSettings, channel); // Set the transcoder options
        ffmpeg.setAudioOnly(audioOnly);
        let stopped = false;

        function stop() {
            if (!stopped) {
                stopped = true;
                try {
                    res.end();
                } catch (err) {}
                ffmpeg.kill();
            }
        }

        ffmpeg.on("error", (err) => {
            console.error("FFMPEG ERROR", err);
            // status was already sent
            stop();
            return;
        });

        ffmpeg.on("close", stop);

        res.on("close", () => {
            // on HTTP close, kill ffmpeg
            console.log(`\r\nStream ended. Channel: ${channel.number} (${channel.name})`);
            stop();
        });

        ffmpeg.on("end", () => {
            console.log(
                "Video queue exhausted. Either you played 100 different clips in a row or there were technical issues that made all of the possible 100 attempts fail.",
            );
            stop();
        });

        const channelNum = parseInt(req.query.channel, 10);
        const ff = await ffmpeg.spawnConcat(
            `http://localhost:${process.env.PORT}/playlist?channel=${channelNum}&audioOnly=${audioOnly}`,
        );
        ff.pipe(res);
    };
    router.get("/video", async (req, res) => {
        return await concat(req, res, false);
    });
    router.get("/radio", async (req, res) => {
        return await concat(req, res, true);
    });

    // Stream individual video to ffmpeg concat above. This is used by the server, NOT the client
    const streamFunction = async (req, res, t0, allowSkip) => {
        if (stopPlayback) {
            res.status(503).send("Server is shutting down.");
            return;
        }

        // Check if channel queried is valid
        res.on("error", (e) => {
            console.error("There was an unexpected error in stream.", e);
        });
        if (typeof req.query.channel === "undefined") {
            res.status(400).send("No Channel Specified");
            return;
        }

        const audioOnly = "true" == req.query.audioOnly;
        console.log(`/stream audioOnly=${audioOnly}`);
        const session = parseInt(req.query.session);
        const m3u8 = req.query.m3u8 === "1";
        const number = parseInt(req.query.channel);
        const channel = await channelService.getChannel(number);

        if (channel == null) {
            res.status(404).send("Channel doesn't exist");
            return;
        }
        let isLoading = false;
        if (typeof req.query.first !== "undefined" && req.query.first == "0") {
            isLoading = true;
        }

        let isFirst = false;
        if (typeof req.query.first !== "undefined" && req.query.first == "1") {
            isFirst = true;
        }

        const isBetween = typeof req.query.between !== "undefined" && req.query.between == "1";

        const ffmpegSettings = db["ffmpeg-settings"].find()[0];

        // Check if ffmpeg path is valid
        if (!existsSync(ffmpegSettings.ffmpegPath)) {
            res.status(500).send("FFMPEG path is invalid. The file (executable) doesn't exist.");
            console.error("The FFMPEG Path is invalid. Please check your configuration.");
            return;
        }

        // Get video lineup (array of video urls with calculated start times and durations.)

        let prog = null;
        let brandChannel = channel;
        let redirectChannels = [];
        let upperBounds = [];

        const GAP_DURATION = 750;
        if (isLoading) {
            lineupItem = {
                type: "loading",
                title: "Loading Screen",
                streamDuration: GAP_DURATION,
                duration: GAP_DURATION,
                redirectChannels: [channel],
                start: 0,
            };
        } else if (isBetween) {
            lineupItem = {
                type: "interlude",
                title: "Interlude Screen",
                streamDuration: GAP_DURATION,
                duration: GAP_DURATION,
                redirectChannels: [channel],
                start: 0,
            };
        } else {
            lineupItem = getCurrentLineupItem(channel.number, t0);
        }
        if (lineupItem != null) {
            redirectChannels = lineupItem.redirectChannels;
            upperBounds = lineupItem.upperBounds;
            brandChannel = redirectChannels[redirectChannels.length - 1];
        } else {
            prog = programmingService.getCurrentProgramAndTimeElapsed(t0, channel);
            activeChannelService.peekChannel(t0, channel.number);

            while (true) {
                redirectChannels.push(generateChannelContext(brandChannel));
                upperBounds.push(prog.program.duration - prog.timeElapsed);

                if (!prog.program.isOffline || prog.program.type != "redirect") {
                    break;
                }
                recordPlayback(brandChannel.number, t0, {
                    /* type: 'offline',*/
                    title: "Error",
                    err: Error("Recursive channel redirect found"),
                    duration: 60000,
                    start: 0,
                });

                const newChannelNumber = prog.program.channel;
                const newChannel = await channelService.getChannel(newChannelNumber);

                if (newChannel == null) {
                    const err = Error("Invalid redirect to a channel that doesn't exist");
                    console.error("Invalid redirect to channel that doesn't exist.", err);
                    prog = {
                        program: {
                            isOffline: true,
                            err: err,
                            duration: 60000,
                        },
                        timeElapsed: 0,
                    };
                    continue;
                }
                brandChannel = newChannel;
                lineupItem = getCurrentLineupItem(newChannel.number, t0);
                if (lineupItem != null) {
                    lineupItem = JSON.parse(JSON.stringify(lineupItem));
                    break;
                } else {
                    prog = programmingService.getCurrentProgramAndTimeElapsed(t0, newChannel);
                    activeChannelService.peekChannel(t0, newChannel.number);
                }
            }
        }
        if (lineupItem == null) {
            if (prog == null) {
                res.status(500).send("server error");
                throw Error("Shouldn't prog be non-null?");
            }
            if (prog.program.isOffline && channel.programs.length == 1 && prog.programIndex != -1) {
                // there's only one program and it's offline. So really, the channel is
                // permanently offline, it doesn't matter what duration was set
                // and it's best to give it a long duration to ensure there's always
                // filler to play (if any)
                const t = 365 * 24 * 60 * 60 * 1000;
                prog.program = {
                    duration: t,
                    isOffline: true,
                };
            } else if (allowSkip && prog.program.isOffline && prog.program.duration - prog.timeElapsed <= SLACK + 1) {
                // it's pointless to show the offline screen for such a short time, might as well
                // skip to the next program
                const dt = prog.program.duration - prog.timeElapsed;
                for (let i = 0; i < redirectChannels.length; i++) {
                    clearPlayback(redirectChannels[i].number);
                }
                console.log("Too litlle time before the filler ends, skip to next slot");
                return await streamFunction(req, res, t0 + dt + 1, false);
            }
            if (
                prog == null ||
                typeof prog === "undefined" ||
                prog.program == null ||
                typeof prog.program == "undefined"
            ) {
                throw "No video to play, this means there's a serious unexpected bug or the channel db is corrupted.";
            }
            const fillers = await fillerDB.getFillersFromChannel(brandChannel);
            const lineup = createLineup(prog, brandChannel, fillers, isFirst);
            lineupItem = lineup.shift();
        }

        if (!isBetween && !isLoading && lineupItem != null) {
            let upperBound = 1000000000;
            let beginningOffset = 0;
            if (typeof lineupItem.beginningOffset !== "undefined") {
                beginningOffset = lineupItem.beginningOffset;
            }
            // adjust upper bounds and record playbacks
            for (let i = redirectChannels.length - 1; i >= 0; i--) {
                lineupItem = JSON.parse(JSON.stringify(lineupItem));
                lineupItem.redirectChannels = redirectChannels;
                lineupItem.upperBounds = upperBounds;
                const u = upperBounds[i] + beginningOffset;
                if (typeof u !== "undefined") {
                    let u2 = upperBound;
                    if (typeof lineupItem.streamDuration !== "undefined") {
                        u2 = Math.min(u2, lineupItem.streamDuration);
                    }
                    lineupItem.streamDuration = Math.min(u2, u);
                    upperBound = lineupItem.streamDuration;
                }
                recordPlayback(redirectChannels[i].number, t0, lineupItem);
            }
        }

        console.log("=========================================================");
        console.log("! Start playback");
        console.log(`! Channel: ${channel.name} (${channel.number})`);
        if (typeof lineupItem.title === "undefined") {
            lineupItem.title = "Unknown";
        }
        console.log(`! Title: ${lineupItem.title}`);
        if (typeof lineupItem.streamDuration === "undefined") {
            console.log(`! From : ${lineupItem.start}`);
        } else {
            console.log(`! From : ${lineupItem.start} to: ${lineupItem.start + lineupItem.streamDuration}`);
        }
        console.log("=========================================================");

        if (!isLoading && !isBetween) {
            recordPlayback(channel.number, t0, lineupItem);
        }
        if (wereThereTooManyAttempts(session, lineupItem)) {
            console.error(
                "There are too many attempts to play the same item in a short period of time, playing the error stream instead.",
            );
            lineupItem = {
                isOffline: true,
                err: Error("Too many attempts, throttling.."),
                duration: 60000,
            };
        }

        const combinedChannel = generateChannelContext(brandChannel);
        combinedChannel.transcoding = channel.transcoding;

        const playerContext = {
            lineupItem: lineupItem,
            ffmpegSettings: ffmpegSettings,
            channel: combinedChannel,
            db: db,
            m3u8: m3u8,
            audioOnly: audioOnly,
        };

        let player = new ProgramPlayer(playerContext);
        let stopped = false;
        let stop = () => {
            if (!stopped) {
                stopped = true;
                player.cleanUp();
                player = null;
                res.end();
            }
        };
        let playerObj = null;
        res.writeHead(200, {
            "Content-Type": "video/mp2t",
        });

        shieldActiveChannels(redirectChannels, t0, START_CHANNEL_GRACE_PERIOD);

        let t1;

        try {
            playerObj = await player.play(res);
            t1 = new Date().getTime();
            console.log("Latency: (" + (t1 - t0));
        } catch (err) {
            console.log("Error when attempting to play video: " + err.stack);
            try {
                res.status(500).send("Unable to start playing video.").end();
            } catch (err2) {
                console.log(err2.stack);
            }
            stop();
            return;
        }

        if (!isLoading) {
            // setup end event to mark the channel as not playing anymore
            let t0 = new Date().getTime();
            let b = 0;
            let stopDetected = false;
            if (typeof lineupItem.beginningOffset !== "undefined") {
                b = lineupItem.beginningOffset;
                t0 -= b;
            }

            // we have to do it for every single redirected channel...

            for (let i = redirectChannels.length - 1; i >= 0; i--) {
                activeChannelService.registerChannelActive(t0, redirectChannels[i].number);
            }
            const listener = (data) => {
                if (data.ignoreOnDemand) {
                    console.log("Ignore channel update because it is from on-demand service");
                    return;
                }
                let shouldStop = false;
                try {
                    for (let i = 0; i < redirectChannels.length; i++) {
                        if (redirectChannels[i].number == data.channelNumber) {
                            shouldStop = true;
                        }
                    }
                    if (shouldStop) {
                        console.log("Playing channel has received an update.");
                        shieldActiveChannels(redirectChannels, t0, CHANNEL_STOP_SHIELD);
                        setTimeout(stop, 100);
                    }
                } catch (error) {
                    console.err("Unexpected error when processing channel change during playback", error);
                }
            };
            channelService.on("channel-update", listener);

            const oldStop = stop;
            stop = () => {
                channelService.removeListener("channel-update", listener);
                if (!stopDetected) {
                    stopDetected = true;
                    let t1 = new Date().getTime();
                    t1 = Math.max(t0 + 1, t1 - FORGETFULNESS_BUFFER - b);
                    for (let i = redirectChannels.length - 1; i >= 0; i--) {
                        activeChannelService.registerChannelStopped(t1, redirectChannels[i].number);
                    }
                }
                oldStop();
            };
        }
        const stream = playerObj;

        // res.write(playerObj.data);

        stream.on("end", () => {
            const t2 = new Date().getTime();
            console.log("Played video for: " + (t2 - t1) + " ms");
            stop();
        });
        res.on("close", () => {
            const t2 = new Date().getTime();
            console.log("Played video for: " + (t2 - t1) + " ms");
            console.log("Client Closed");
            stop();
        });
    };

    router.get("/stream", async (req, res) => {
        const t0 = new Date().getTime();
        return await streamFunction(req, res, t0, true);
    });

    router.get("/m3u8", async (req, res) => {
        if (stopPlayback) {
            res.status(503).send("Server is shutting down.");
            return;
        }

        const sessionId = StreamCount++;

        // res.type('application/vnd.apple.mpegurl')
        res.type("application/x-mpegURL");

        // Check if channel queried is valid
        if (typeof req.query.channel === "undefined") {
            res.status(500).send("No Channel Specified");
            return;
        }

        const channelNum = parseInt(req.query.channel, 10);
        const channel = await channelService.getChannel(channelNum);
        if (channel == null) {
            res.status(500).send("Channel doesn't exist");
            return;
        }

        // Maximum number of streams to concatinate beyond channel starting
        // If someone passes this number then they probably watch too much television
        const maxStreamsToPlayInARow = 100;

        let data = "#EXTM3U\n";

        data += `#EXT-X-VERSION:3
        #EXT-X-MEDIA-SEQUENCE:0
        #EXT-X-ALLOW-CACHE:YES
        #EXT-X-TARGETDURATION:60
        #EXT-X-PLAYLIST-TYPE:VOD\n`;

        const ffmpegSettings = db["ffmpeg-settings"].find()[0];

        cur = "59.0";

        if (ffmpegSettings.enableFFMPEGTranscoding === true) {
            // data += `#EXTINF:${cur},\n`;
            data += `${req.protocol}://${req.get(
                "host",
            )}/stream?channel=${channelNum}&first=0&m3u8=1&session=${sessionId}\n`;
        }
        // data += `#EXTINF:${cur},\n`;
        data += `${req.protocol}://${req.get(
            "host",
        )}/stream?channel=${channelNum}&first=1&m3u8=1&session=${sessionId}\n`;
        for (let i = 0; i < maxStreamsToPlayInARow - 1; i++) {
            // data += `#EXTINF:${cur},\n`;
            data += `${req.protocol}://${req.get("host")}/stream?channel=${channelNum}&m3u8=1&session=${sessionId}\n`;
        }

        res.send(data);
    });
    router.get("/playlist", async (req, res) => {
        if (stopPlayback) {
            res.status(503).send("Server is shutting down.");
            return;
        }

        res.type("text");

        // Check if channel queried is valid
        if (typeof req.query.channel === "undefined") {
            res.status(500).send("No Channel Specified");
            return;
        }

        const channelNum = parseInt(req.query.channel, 10);
        const channel = await channelService.getChannel(channelNum);
        if (channel == null) {
            res.status(500).send("Channel doesn't exist");
            return;
        }

        // Maximum number of streams to concatinate beyond channel starting
        // If someone passes this number then they probably watch too much television
        const maxStreamsToPlayInARow = 100;

        let data = "ffconcat version 1.0\n";

        const ffmpegSettings = db["ffmpeg-settings"].find()[0];

        const sessionId = StreamCount++;
        const audioOnly = "true" == req.query.audioOnly;

        if (
            ffmpegSettings.enableFFMPEGTranscoding === true &&
            ffmpegSettings.normalizeVideoCodec === true &&
            ffmpegSettings.normalizeAudioCodec === true &&
            ffmpegSettings.normalizeResolution === true &&
            ffmpegSettings.normalizeAudio === true &&
            audioOnly !==
                true /* loading screen is pointless in audio mode (also for some reason it makes it fail when codec is aac, and I can't figure out why) */
        ) {
            // loading screen
            data += `file 'http://localhost:${process.env.PORT}/stream?channel=${channelNum}&first=0&session=${sessionId}&audioOnly=${audioOnly}'\n`;
        }
        data += `file 'http://localhost:${process.env.PORT}/stream?channel=${channelNum}&first=1&session=${sessionId}&audioOnly=${audioOnly}'\n`;

        data += `file 'http://localhost:${process.env.PORT}/stream?channel=${channelNum}&between=1&session=${sessionId}&audioOnly=${audioOnly}'\n`;

        for (let i = 0; i < maxStreamsToPlayInARow - 1; i++) {
            data += `file 'http://localhost:${process.env.PORT}/stream?channel=${channelNum}&session=${sessionId}&audioOnly=${audioOnly}'\n`;
            data += `file 'http://localhost:${process.env.PORT}/stream?channel=${channelNum}&between=1&session=${sessionId}&audioOnly=${audioOnly}'\n`;
        }

        res.send(data);
    });

    const shieldActiveChannels = (channelList, t0, timeout) => {
        // because of channel redirects, it's possible that multiple channels
        // are being played at once. Mark all of them as being played
        // this is a grave period of 30
        // mark all channels being played as active:
        for (let i = channelList.length - 1; i >= 0; i--) {
            activeChannelService.registerChannelActive(t0, channelList[i].number);
        }
        setTimeout(() => {
            for (let i = channelList.length - 1; i >= 0; i--) {
                activeChannelService.registerChannelStopped(t0, channelList[i].number);
            }
        }, timeout);
    };

    const mediaPlayer = async (channelNum, path, req, res) => {
        const channel = await channelService.getChannel(channelNum);
        if (channel === null) {
            res.status(404).send("Channel not found.");
            return;
        }
        res.type("video/x-mpegurl");
        res.status(200).send(`#EXTM3U\n${req.protocol}://${req.get("host")}/${path}?channel=${channelNum}\n\n`);
    };

    router.get("/media-player/:number.m3u", async (req, res) => {
        try {
            const channelNum = parseInt(req.params.number, 10);
            let path = "video";
            if (req.query.fast === "1") {
                path = "m3u8";
            }
            return await mediaPlayer(channelNum, path, req, res);
        } catch (err) {
            console.error(err);
            res.status(500).send("There was an error.");
        }
    });

    router.get("/media-player/fast/:number.m3u", async (req, res) => {
        try {
            const channelNum = parseInt(req.params.number, 10);
            const path = "m3u8";
            return await mediaPlayer(channelNum, path, req, res);
        } catch (err) {
            console.error(err);
            res.status(500).send("There was an error.");
        }
    });

    router.get("/media-player/radio/:number.m3u", async (req, res) => {
        try {
            const channelNum = parseInt(req.params.number, 10);
            const path = "radio";
            return await mediaPlayer(channelNum, path, req, res);
        } catch (err) {
            console.error(err);
            res.status(500).send("There was an error.");
        }
    });

    return router;
}
