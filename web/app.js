import angular, { module } from "angular";

import arb from "angular-router-browserify";
arb(angular);

import lazyload from "./ext/lazyload.js";
lazyload(angular);

import plex from "./services/plex.js";
import dizquetv from "./services/dizquetv.js";
import resolutionOptions from "./services/resolution-options.js";
import getShowData from "./services/get-show-data.js";
import commonProgramTools from "./services/common-program-tools.js";

import plexSettings from "./directives/plex-settings.js";
import ffmpegSettings from "./directives/ffmpeg-settings";
import xmltvSettings from "./directives/xmltv-settings.js";
import hdhrSettings from "./directives/hdhr-settings.js";
import plexLibrary from "./directives/plex-library.js";
import programConfig from "./directives/program-config.js";
import flexConfig from "./directives/flex-config.js";
import timeSlotsTimeEditor from "./directives/time-slots-time-editor.js";
import toastNotifications from "./directives/toast-notifications.js";
import fillerConfig from "./directives/filler-config.js";
import showConfig from "./directives/show-config.js";
import deleteFiller from "./directives/delete-filler.js";
import frequencyTweak from "./directives/frequency-tweak.js";
import removeShows from "./directives/remove-shows.js";
import channelRedirect from "./directives/channel-redirect.js";
import plexServerEdit from "./directives/plex-server-edit.js";
import channelConfig from "./directives/channel-config.js";
import timeSlotsScheduleEditor from "./directives/time-slots-schedule-editor.js";
import randomSlotsScheduleEditor from "./directives/random-slots-schedule-editor.js";

import settingsCtrl from "./controllers/settings.js";
import channelsCtrl from "./controllers/channels.js";
import versionCtrl from "./controllers/version.js";
import libraryCtrl from "./controllers/library.js";
import guideCtrl from "./controllers/guide.js";
import playerCtrl from "./controllers/player.js";
import fillerCtrl from "./controllers/filler.js";
import customShowsCtrl from "./controllers/custom-shows.js";

import "./ext/dragdrop.js";
import "./ext/angularjs-scroll-glue.js";
import "angular-vs-repeat";
import "angular-sanitize";
import i18next from "i18next";
import i18nextHttpBackend from "i18next-http-backend";
window.i18next = i18next;

window.i18next.use(i18nextHttpBackend);

window.i18next.init(
    {
        // debug: true,
        lng: "en",
        fallbackLng: "en",
        preload: ["en"],
        ns: ["main"],
        defaultNS: ["main"],
        initImmediate: false,
        backend: {
            loadPath: "/locales/{{lng}}/{{ns}}.json",
        },
        useCookie: false,
        useLocalStorage: false,
    },
    function (err, t) {
        console.log("resources loaded");
    },
);

import "ng-i18next";

const app = module("myApp", ["ngRoute", "vs-repeat", "angularLazyImg", "dndLists", "luegg.directives", "jm.i18next"]);

app.service("plex", plex);
app.service("dizquetv", dizquetv);
app.service("resolutionOptions", resolutionOptions);
app.service("getShowData", getShowData);
app.service("commonProgramTools", commonProgramTools);

app.directive("plexSettings", plexSettings);
app.directive("ffmpegSettings", ffmpegSettings);
app.directive("xmltvSettings", xmltvSettings);
app.directive("hdhrSettings", hdhrSettings);
app.directive("plexLibrary", plexLibrary);
app.directive("programConfig", programConfig);
app.directive("flexConfig", flexConfig);
app.directive("timeSlotsTimeEditor", timeSlotsTimeEditor);
app.directive("toastNotifications", toastNotifications);
app.directive("fillerConfig", fillerConfig);
app.directive("showConfig", showConfig);
app.directive("deleteFiller", deleteFiller);
app.directive("frequencyTweak", frequencyTweak);
app.directive("removeShows", removeShows);
app.directive("channelRedirect", channelRedirect);
app.directive("plexServerEdit", plexServerEdit);
app.directive("channelConfig", channelConfig);
app.directive("timeSlotsScheduleEditor", timeSlotsScheduleEditor);
app.directive("randomSlotsScheduleEditor", randomSlotsScheduleEditor);

app.controller("settingsCtrl", settingsCtrl);
app.controller("channelsCtrl", channelsCtrl);
app.controller("versionCtrl", versionCtrl);
app.controller("libraryCtrl", libraryCtrl);
app.controller("guideCtrl", guideCtrl);
app.controller("playerCtrl", playerCtrl);
app.controller("fillerCtrl", fillerCtrl);
app.controller("customShowsCtrl", customShowsCtrl);

app.config(function ($routeProvider) {
    $routeProvider
        .when("/settings", {
            templateUrl: "views/settings.html",
            controller: "settingsCtrl",
        })
        .when("/channels", {
            templateUrl: "views/channels.html",
            controller: "channelsCtrl",
        })
        .when("/filler", {
            templateUrl: "views/filler.html",
            controller: "fillerCtrl",
        })
        .when("/custom-shows", {
            templateUrl: "views/custom-shows.html",
            controller: "customShowsCtrl",
        })
        .when("/library", {
            templateUrl: "views/library.html",
            controller: "libraryCtrl",
        })
        .when("/guide", {
            templateUrl: "views/guide.html",
            controller: "guideCtrl",
        })
        .when("/player", {
            templateUrl: "views/player.html",
            controller: "playerCtrl",
        })
        .when("/version", {
            templateUrl: "views/version.html",
            controller: "versionCtrl",
        })
        .otherwise({
            redirectTo: "guide",
        });
});
