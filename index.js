import db from "diskdb";

import bodyParser from "body-parser";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve as _resolve } from "path";
import express from "express";
import fileUpload from "express-fileupload";
import i18next, { use, t as _t } from "i18next";
import { LanguageDetector, handle } from "i18next-http-middleware/cjs";
import i18nextBackend from "i18next-fs-backend/cjs";

import { router } from "./src/api.js";
import { initDB as _initDB } from "./src/database-migration.js";
import { router as _router, shutdown } from "./src/video.js";
import HDHR from "./src/hdhr.js";
import FileCacheService from "./src/services/file-cache-service.js";
import CacheImageService from "./src/services/cache-image-service.js";
import ChannelService from "./src/services/channel-service.js";

import { shutdown as _shutdown } from "./src/xmltv.js";
import Plex from "./src/plex.js";
import { VERSION_NAME } from "./src/constants.js";
import ChannelDB from "./src/dao/channel-db.js";
import M3uService from "./src/services/m3u-service.js";
import FillerDB from "./src/dao/filler-db.js";
import CustomShowDB from "./src/dao/custom-show-db.js";
import TVGuideService from "./src/services/tv-guide-service.js";
import EventService from "./src/services/event-service.js";
import OnDemandService from "./src/services/on-demand-service.js";
import ProgrammingService from "./src/services/programming-service.js";
import ActiveChannelService from "./src/services/active-channel-service.js";

import { onShutdown } from "node-graceful-shutdown";

console.log(
    `         \\
   dizqueTV ${VERSION_NAME}
.------------.
|:::///### o |
|:::///###   |
':::///### o |
'------------'
`,
);

const NODE = parseInt(process.version.match(/^[^0-9]*(\d+)\..*$/)[1]);

if (NODE < 12) {
    console.error(
        `WARNING: Your nodejs version ${process.version} is lower than supported. dizqueTV has been tested best on nodejs 12.16.`,
    );
}

for (let i = 0, l = process.argv.length; i < l; i++) {
    if ((process.argv[i] === "-p" || process.argv[i] === "--port") && i + 1 !== l)
        process.env.PORT = process.argv[i + 1];
    if ((process.argv[i] === "-d" || process.argv[i] === "--database") && i + 1 !== l)
        process.env.DATABASE = process.argv[i + 1];
}

process.env.DATABASE = process.env.DATABASE || join(".", ".dizquetv");
process.env.PORT = process.env.PORT || 8000;

console.log(process.env.DATABASE);

if (!existsSync(process.env.DATABASE)) {
    if (existsSync(join(".", ".pseudotv"))) {
        throw Error(
            process.env.DATABASE +
                " folder not found but ./.pseudotv has been found. Please rename this folder or create an empty " +
                process.env.DATABASE +
                " folder so that the program is not confused about.",
        );
    }
    mkdirSync(process.env.DATABASE);
}

if (!existsSync(join(process.env.DATABASE, "images"))) {
    mkdirSync(join(process.env.DATABASE, "images"));
}
if (!existsSync(join(process.env.DATABASE, "channels"))) {
    mkdirSync(join(process.env.DATABASE, "channels"));
}
if (!existsSync(join(process.env.DATABASE, "filler"))) {
    mkdirSync(join(process.env.DATABASE, "filler"));
}
if (!existsSync(join(process.env.DATABASE, "custom-shows"))) {
    mkdirSync(join(process.env.DATABASE, "custom-shows"));
}
if (!existsSync(join(process.env.DATABASE, "cache"))) {
    mkdirSync(join(process.env.DATABASE, "cache"));
}
if (!existsSync(join(process.env.DATABASE, "cache", "images"))) {
    mkdirSync(join(process.env.DATABASE, "cache", "images"));
}

const channelDB = new ChannelDB(join(process.env.DATABASE, "channels"));

db.connect(process.env.DATABASE, [
    "channels",
    "plex-servers",
    "ffmpeg-settings",
    "plex-settings",
    "xmltv-settings",
    "hdhr-settings",
    "db-version",
    "client-id",
    "cache-images",
    "settings",
]);
initDB(db, channelDB);

const channelService = new ChannelService(channelDB);

const fillerDB = new FillerDB(join(process.env.DATABASE, "filler"), channelService);
const customShowDB = new CustomShowDB(join(process.env.DATABASE, "custom-shows"));

const fileCache = new FileCacheService(join(process.env.DATABASE, "cache"));
const cacheImageService = new CacheImageService(db, fileCache);
const m3uService = new M3uService(fileCache, channelService);

const onDemandService = new OnDemandService(channelService);
const programmingService = new ProgrammingService(onDemandService);
const activeChannelService = new ActiveChannelService(onDemandService, channelService);

const eventService = new EventService();

use(i18nextBackend)
    .use(LanguageDetector)
    .init({
        // debug: true,
        initImmediate: false,
        backend: {
            loadPath: join(__dirname, "/locales/server/{{lng}}.json"),
            addPath: join(__dirname, "/locales/server/{{lng}}.json"),
        },
        lng: "en",
        fallbackLng: "en",
        preload: ["en"],
    });

const guideService = new TVGuideService(db, cacheImageService, null, i18next);

const xmltvInterval = {
    interval: null,
    lastRefresh: null,
    updateXML: async () => {
        let channels = [];

        try {
            channels = await channelService.getAllChannels();
            const xmltvSettings = db["xmltv-settings"].find()[0];
            const t = guideService.prepareRefresh(channels, xmltvSettings.cache * 60 * 60 * 1000);
            channels = null;

            guideService.refresh(t);
        } catch (err) {
            console.error("Unable to update TV guide?", err);
            return;
        }
    },

    notifyPlex: async () => {
        xmltvInterval.lastRefresh = new Date();
        console.log("XMLTV Updated at ", xmltvInterval.lastRefresh.toLocaleString());

        const channels = await channelService.getAllChannels();

        const plexServers = db["plex-servers"].find();
        for (let i = 0, l = plexServers.length; i < l; i++) {
            // Foreach plex server
            const plex = new Plex(plexServers[i]);
            let dvrs;
            if (!plexServers[i].arGuide && !plexServers[i].arChannels) {
                continue;
            }
            try {
                dvrs = await plex.GetDVRS(); // Refresh guide and channel mappings
            } catch (err) {
                console.error(
                    `Couldn't get DVRS list from ${plexServers[i].name}. This error will prevent 'refresh guide' or 'refresh channels' from working for this Plex server. But it is NOT related to playback issues.`,
                    err,
                );
                continue;
            }
            if (plexServers[i].arGuide) {
                try {
                    await plex.RefreshGuide(dvrs);
                } catch (err) {
                    console.error(
                        `Couldn't tell Plex ${plexServers[i].name} to refresh guide for some reason. This error will prevent 'refresh guide' from working for this Plex server. But it is NOT related to playback issues.`,
                        err,
                    );
                }
            }
            if (plexServers[i].arChannels && channels.length !== 0) {
                try {
                    await plex.RefreshChannels(channels, dvrs);
                } catch (err) {
                    console.error(
                        `Couldn't tell Plex ${plexServers[i].name} to refresh channels for some reason. This error will prevent 'refresh channels' from working for this Plex server. But it is NOT related to playback issues.`,
                        err,
                    );
                }
            }
        }
    },

    startInterval: () => {
        const xmltvSettings = db["xmltv-settings"].find()[0];
        if (xmltvSettings.refresh !== 0) {
            xmltvInterval.interval = setInterval(async () => {
                try {
                    await xmltvInterval.updateXML();
                } catch (err) {
                    console.error("update XMLTV error", err);
                }
            }, xmltvSettings.refresh * 60 * 60 * 1000);
        }
    },
    restartInterval: () => {
        if (xmltvInterval.interval !== null) clearInterval(xmltvInterval.interval);
        xmltvInterval.startInterval();
    },
};

guideService.on("xmltv-updated", (data) => {
    try {
        xmltvInterval.notifyPlex();
    } catch (err) {
        console.error("Unexpected issue when reacting to xmltv update", err);
    }
});

xmltvInterval.updateXML();
xmltvInterval.startInterval();

// setup xmltv update
channelService.on("channel-update", (data) => {
    try {
        console.log("Updating TV Guide due to channel update...");
        // TODO: this could be smarter, like avoid updating 3 times if the channel was saved three times in a short time interval...
        xmltvInterval.updateXML();
        xmltvInterval.restartInterval();
    } catch (err) {
        console.error("Unexpected error issuing TV Guide udpate", err);
    }
});

const hdhr = HDHR(db, channelDB);
const app = express();
eventService.setup(app);

app.use(handle(i18next, {}));

app.use(
    fileUpload({
        createParentPath: true,
    }),
);
app.use(bodyParser.json({ limit: "50mb" }));

app.get("/version.js", (req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/javascript",
    });

    res.write(`
        function setUIVersionNow() {
            setTimeout( setUIVersionNow, 1000);
            var element = document.getElementById("uiversion");
            if (element != null) {
                element.innerHTML = "${VERSION_NAME}";
            }
        }
        setTimeout( setUIVersionNow, 1000);
    `);
    res.end();
});
app.use("/images", express.static(join(process.env.DATABASE, "images")));
app.use(express.static(join(__dirname, "web", "public")));
app.use("/images", express.static(join(process.env.DATABASE, "images")));
app.use("/cache/images", cacheImageService.routerInterceptor());
app.use("/cache/images", express.static(join(process.env.DATABASE, "cache", "images")));
app.use("/favicon.svg", express.static(join(__dirname, "resources", "favicon.svg")));
app.use("/custom.css", express.static(join(process.env.DATABASE, "custom.css")));

// API Routers
app.use(router(db, channelService, fillerDB, customShowDB, xmltvInterval, guideService, m3uService, eventService));
app.use("/api/cache/images", cacheImageService.apiRouters());

app.use(_router(channelService, fillerDB, db, programmingService, activeChannelService));
app.use(hdhr.router);
app.listen(process.env.PORT, () => {
    console.log(`HTTP server running on port: http://*:${process.env.PORT}`);
    const hdhrSettings = db["hdhr-settings"].find()[0];
    if (hdhrSettings.autoDiscovery === true) hdhr.ssdp.start();
});

function initDB(db, channelDB) {
    if (!existsSync(process.env.DATABASE + "/images/dizquetv.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/dizquetv.png")));
        writeFileSync(process.env.DATABASE + "/images/dizquetv.png", data);
    }
    _initDB(db, channelDB, __dirname);
    if (!existsSync(process.env.DATABASE + "/font.ttf")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/font.ttf")));
        writeFileSync(process.env.DATABASE + "/font.ttf", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/dizquetv.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/dizquetv.png")));
        writeFileSync(process.env.DATABASE + "/images/dizquetv.png", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/generic-error-screen.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/generic-error-screen.png")));
        writeFileSync(process.env.DATABASE + "/images/generic-error-screen.png", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/generic-offline-screen.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/generic-offline-screen.png")));
        writeFileSync(process.env.DATABASE + "/images/generic-offline-screen.png", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/generic-music-screen.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/generic-music-screen.png")));
        writeFileSync(process.env.DATABASE + "/images/generic-music-screen.png", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/loading-screen.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/loading-screen.png")));
        writeFileSync(process.env.DATABASE + "/images/loading-screen.png", data);
    }
    if (!existsSync(process.env.DATABASE + "/images/black.png")) {
        const data = readFileSync(_resolve(join(__dirname, "resources/black.png")));
        writeFileSync(process.env.DATABASE + "/images/black.png", data);
    }
    if (!existsSync(join(process.env.DATABASE, "custom.css"))) {
        const data = readFileSync(_resolve(join(__dirname, "resources", "default-custom.css")));
        writeFileSync(join(process.env.DATABASE, "custom.css"), data);
    }
}

function _wait(t) {
    return new Promise((resolve) => {
        setTimeout(resolve, t);
    });
}

async function sendEventAfterTime() {
    const t = new Date().getTime();
    await _wait(20000);
    eventService.push("lifecycle", {
        message: _t("event.server_started"),
        detail: {
            time: t,
        },
        level: "success",
    });
}
sendEventAfterTime();

onShutdown("log", [], async () => {
    const t = new Date().getTime();
    eventService.push("lifecycle", {
        message: _t("event.server_shutdown"),
        detail: {
            time: t,
        },
        level: "warning",
    });

    console.log("Received exit signal, attempting graceful shutdonw...");
    await _wait(2000);
});
onShutdown("xmltv-writer", [], async () => {
    await _shutdown();
});
onShutdown("active-channels", [], async () => {
    await activeChannelService.shutdown();
});

onShutdown("video", [], async () => {
    await shutdown();
});
