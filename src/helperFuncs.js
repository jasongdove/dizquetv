"use strict";

module.exports = {
    getCurrentProgramAndTimeElapsed,
    createLineup,
    getWatermark,
    generateChannelContext,
};

const channelCache = require("./channel-cache");
const { SLACK } = require("./constants");
const randomJS = require("random-js");
const { Random } = randomJS;
const random = new Random(randomJS.MersenneTwister19937.autoSeed());

const CHANNEL_CONTEXT_KEYS = [
    "disableFillerOverlay",
    "watermark",
    "icon",
    "offlinePicture",
    "offlineSoundtrack",
    "name",
    "transcoding",
    "number",
];

module.exports.random = random;

function getCurrentProgramAndTimeElapsed(date, channel) {
    const channelStartTime = new Date(channel.startTime).getTime();
    if (channelStartTime > date) {
        const t0 = date;
        const t1 = channelStartTime;
        console.log("Channel start time is above the given date. Flex time is picked till that.");
        return {
            program: {
                isOffline: true,
                duration: t1 - t0,
            },
            timeElapsed: 0,
            programIndex: -1,
        };
    }
    let timeElapsed = (date - channelStartTime) % channel.duration;
    let currentProgramIndex = -1;
    for (let y = 0, l2 = channel.programs.length; y < l2; y++) {
        const program = channel.programs[y];
        if (timeElapsed - program.duration < 0) {
            currentProgramIndex = y;
            if (program.duration > 2 * SLACK && timeElapsed > program.duration - SLACK) {
                timeElapsed = 0;
                currentProgramIndex = (y + 1) % channel.programs.length;
            }
            break;
        } else {
            timeElapsed -= program.duration;
        }
    }

    if (currentProgramIndex === -1) throw new Error("No program found; find algorithm fucked up");

    return {
        program: channel.programs[currentProgramIndex],
        timeElapsed,
        programIndex: currentProgramIndex,
    };
}

function createLineup(obj, channel, fillers, isFirst) {
    let { timeElapsed } = obj;
    // Start time of a file is never consistent unless 0. Run time of an episode can vary.
    // When within 30 seconds of start time, just make the time 0 to smooth things out
    // Helps prevents loosing first few seconds of an episode upon lineup change
    const activeProgram = obj.program;
    let beginningOffset = 0;

    const lineup = [];

    if (typeof activeProgram.err !== "undefined") {
        const remaining = activeProgram.duration - timeElapsed;
        lineup.push({
            type: "offline",
            title: "Error",
            err: activeProgram.err,
            streamDuration: remaining,
            duration: remaining,
            start: 0,
            beginningOffset,
        });
        return lineup;
    }

    if (activeProgram.isOffline === true) {
        //offline case
        let remaining = activeProgram.duration - timeElapsed;
        //look for a random filler to play
        let filler = null;
        let special = null;

        if (channel.offlineMode === "clip" && channel.fallback.length != 0) {
            special = JSON.parse(JSON.stringify(channel.fallback[0]));
        }
        const randomResult = pickRandomWithMaxDuration(
            channel,
            fillers,
            remaining + (isFirst ? 7 * 24 * 60 * 60 * 1000 : 0),
        );
        filler = randomResult.filler;
        if (filler == null && typeof randomResult.minimumWait !== undefined && remaining > randomResult.minimumWait) {
            remaining = randomResult.minimumWait;
        }

        let isSpecial = false;
        if (filler == null) {
            filler = special;
            isSpecial = true;
        }
        if (filler != null) {
            let fillerstart = 0;
            if (isSpecial) {
                if (filler.duration > remaining) {
                    fillerstart = filler.duration - remaining;
                } else {
                    fillerstart = 0;
                }
            } else if (isFirst) {
                fillerstart = Math.max(0, filler.duration - remaining);
                //it's boring and odd to tune into a channel and it's always
                //the start of a commercial.
                const more = Math.max(0, filler.duration - fillerstart - 15000 - SLACK);
                fillerstart += random.integer(0, more);
            }
            lineup.push({
                // just add the video, starting at 0, playing the entire duration
                type: "commercial",
                title: filler.title,
                key: filler.key,
                plexFile: filler.plexFile,
                file: filler.file,
                ratingKey: filler.ratingKey,
                start: fillerstart,
                streamDuration: Math.max(1, Math.min(filler.duration - fillerstart, remaining)),
                duration: filler.duration,
                fillerId: filler.fillerId,
                beginningOffset,
                serverKey: filler.serverKey,
            });
            return lineup;
        }
        // pick the offline screen
        remaining = Math.min(remaining, 10 * 60 * 1000);
        //don't display the offline screen for longer than 10 minutes. Maybe the
        //channel's admin might change the schedule during that time and then
        //it would be better to start playing the content.
        lineup.push({
            type: "offline",
            title: "Channel Offline",
            streamDuration: remaining,
            beginningOffset,
            duration: remaining,
            start: 0,
        });
        return lineup;
    }
    const originalTimeElapsed = timeElapsed;
    if (timeElapsed < 30000) {
        timeElapsed = 0;
    }
    beginningOffset = Math.max(0, originalTimeElapsed - timeElapsed);

    return [
        {
            type: "program",
            title: activeProgram.title,
            key: activeProgram.key,
            plexFile: activeProgram.plexFile,
            file: activeProgram.file,
            ratingKey: activeProgram.ratingKey,
            start: timeElapsed,
            streamDuration: activeProgram.duration - timeElapsed,
            beginningOffset,
            duration: activeProgram.duration,
            serverKey: activeProgram.serverKey,
        },
    ];
}

function weighedPick(a, total) {
    return random.bool(a, total);
}

function pickRandomWithMaxDuration(channel, fillers, maxDuration) {
    let list = [];
    for (let i = 0; i < fillers.length; i++) {
        list = list.concat(fillers[i].content);
    }
    let pick1 = null;

    const t0 = new Date().getTime();
    let minimumWait = 1000000000;
    const D = 7 * 24 * 60 * 60 * 1000;
    const E = 5 * 60 * 60 * 1000;
    if (typeof channel.fillerRepeatCooldown === "undefined") {
        channel.fillerRepeatCooldown = 30 * 60 * 1000;
    }
    let listM = 0;
    let fillerId;
    for (let j = 0; j < fillers.length; j++) {
        list = fillers[j].content;
        let pickedList = false;
        let n = 0;

        for (let i = 0; i < list.length; i++) {
            const clip = list[i];
            // a few extra milliseconds won't hurt anyone, would it? dun dun dun
            if (clip.duration <= maxDuration + SLACK) {
                const t1 = channelCache.getProgramLastPlayTime(channel.number, clip);
                let timeSince = t1 == 0 ? D : t0 - t1;

                if (timeSince < channel.fillerRepeatCooldown - SLACK) {
                    const w = channel.fillerRepeatCooldown - timeSince;
                    if (clip.duration + w <= maxDuration + SLACK) {
                        minimumWait = Math.min(minimumWait, w);
                    }
                    timeSince = 0;
                    //30 minutes is too little, don't repeat it at all
                } else if (!pickedList) {
                    const t1 = channelCache.getFillerLastPlayTime(channel.number, fillers[j].id);
                    const timeSince = t1 == 0 ? D : t0 - t1;
                    if (timeSince + SLACK >= fillers[j].cooldown) {
                        //should we pick this list?
                        listM += fillers[j].weight;
                        if (weighedPick(fillers[j].weight, listM)) {
                            pickedList = true;
                            fillerId = fillers[j].id;
                            n = 0;
                        } else {
                            break;
                        }
                    } else {
                        const w = fillers[j].cooldown - timeSince;
                        if (clip.duration + w <= maxDuration + SLACK) {
                            minimumWait = Math.min(minimumWait, w);
                        }

                        break;
                    }
                }
                if (timeSince <= 0) {
                    continue;
                }
                const s = norm_s(timeSince >= E ? E : timeSince);
                const d = norm_d(clip.duration);
                const w = s + d;
                n += w;
                if (weighedPick(w, n)) {
                    pick1 = clip;
                }
            }
        }
    }
    let pick = pick1;
    let pickTitle = "null";
    if (pick != null) {
        pickTitle = pick.title;
        pick = JSON.parse(JSON.stringify(pick));
        pick.fillerId = fillerId;
    }

    return {
        filler: pick,
        minimumWait,
    };
}

function norm_d(x) {
    x /= 60 * 1000;
    if (x >= 3.0) {
        x = 3.0 + Math.log(x);
    }
    const y = 10000 * (Math.ceil(x * 1000) + 1);
    return Math.ceil(y / 1000000) + 1;
}

function norm_s(x) {
    let y = Math.ceil(x / 600) + 1;
    y *= y;
    return Math.ceil(y / 1000000) + 1;
}

// any channel thing used here should be added to channel context
function getWatermark(ffmpegSettings, channel, type) {
    if (!ffmpegSettings.enableFFMPEGTranscoding || ffmpegSettings.disableChannelOverlay) {
        return null;
    }
    let d = channel.disableFillerOverlay;
    if (typeof d === "undefined") {
        d = true;
    }
    if (typeof type !== `undefined` && type == "commercial" && d) {
        return null;
    }
    let e = false;
    let icon;
    let watermark = {};
    if (typeof channel.watermark !== "undefined") {
        watermark = channel.watermark;
        e = watermark.enabled === true;
        icon = watermark.url;
    }
    if (!e) {
        return null;
    }
    if (typeof icon === "undefined" || icon === "") {
        icon = channel.icon;
        if (typeof icon === "undefined" || icon === "") {
            return null;
        }
    }
    const result = {
        url: icon,
        width: watermark.width,
        verticalMargin: watermark.verticalMargin,
        horizontalMargin: watermark.horizontalMargin,
        duration: watermark.duration,
        position: watermark.position,
        fixedSize: watermark.fixedSize === true,
        animated: watermark.animated === true,
    };
    return result;
}

function generateChannelContext(channel) {
    const channelContext = {};
    for (let i = 0; i < CHANNEL_CONTEXT_KEYS.length; i++) {
        const key = CHANNEL_CONTEXT_KEYS[i];

        if (typeof channel[key] !== "undefined") {
            channelContext[key] = JSON.parse(JSON.stringify(channel[key]));
        }
    }
    return channelContext;
}
