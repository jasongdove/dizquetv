"use strict";

module.exports = function ($http, $q) {
    return {
        getVersion: () => $http.get("/api/version").then((d) => d.data),
        getPlexServers: () => $http.get("/api/plex-servers").then((d) => d.data),
        addPlexServer: (plexServer) =>
            $http({
                method: "PUT",
                url: "/api/plex-servers",
                data: plexServer,
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        updatePlexServer: (plexServer) =>
            $http({
                method: "POST",
                url: "/api/plex-servers",
                data: plexServer,
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        checkExistingPlexServer: async (serverName) => {
            const d = await $http({
                method: "POST",
                url: "/api/plex-servers/status",
                data: { name: serverName },
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },
        checkNewPlexServer: async (server) => {
            const d = await $http({
                method: "POST",
                url: "/api/plex-servers/foreignstatus",
                data: server,
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },
        removePlexServer: async (serverName) => {
            const d = await $http({
                method: "DELETE",
                url: "/api/plex-servers",
                data: { name: serverName },
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },
        getPlexSettings: () => $http.get("/api/plex-settings").then((d) => d.data),
        updatePlexSettings: (config) =>
            $http({
                method: "PUT",
                url: "/api/plex-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        resetPlexSettings: (config) =>
            $http({
                method: "POST",
                url: "/api/plex-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        getFfmpegSettings: () => $http.get("/api/ffmpeg-settings").then((d) => d.data),
        updateFfmpegSettings: (config) =>
            $http({
                method: "PUT",
                url: "/api/ffmpeg-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        resetFfmpegSettings: (config) =>
            $http({
                method: "POST",
                url: "/api/ffmpeg-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        getXmltvSettings: () => $http.get("/api/xmltv-settings").then((d) => d.data),
        updateXmltvSettings: (config) =>
            $http({
                method: "PUT",
                url: "/api/xmltv-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        resetXmltvSettings: (config) =>
            $http({
                method: "POST",
                url: "/api/xmltv-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        getHdhrSettings: () => $http.get("/api/hdhr-settings").then((d) => d.data),
        updateHdhrSettings: (config) =>
            $http({
                method: "PUT",
                url: "/api/hdhr-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        resetHdhrSettings: (config) =>
            $http({
                method: "POST",
                url: "/api/hdhr-settings",
                data: angular.toJson(config),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        getChannels: () => $http.get("/api/channels").then((d) => d.data),

        getChannel: (number) => $http.get(`/api/channel/${number}`).then((d) => d.data),

        getChannelDescription: (number) => $http.get(`/api/channel/description/${number}`).then((d) => d.data),

        getChannelProgramless: (number) => $http.get(`/api/channel/programless/${number}`).then((d) => d.data),
        getChannelPrograms: (number) => $http.get(`/api/channel/programs/${number}`).then((d) => d.data),

        getChannelNumbers: () => $http.get("/api/channelNumbers").then((d) => d.data),

        addChannel: (channel) =>
            $http({
                method: "POST",
                url: "/api/channel",
                data: angular.toJson(channel),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        uploadImage: (file) =>
            $http({
                method: "POST",
                url: "/api/upload/image",
                data: file,
                headers: { "Content-Type": undefined },
            }).then((d) => d.data),
        addChannelWatermark: (file) =>
            $http({
                method: "POST",
                url: "/api/channel/watermark",
                data: file,
                headers: { "Content-Type": undefined },
            }).then((d) => d.data),
        updateChannel: (channel) =>
            $http({
                method: "PUT",
                url: "/api/channel",
                data: angular.toJson(channel),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),
        removeChannel: (channel) =>
            $http({
                method: "DELETE",
                url: "/api/channel",
                data: angular.toJson(channel),
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((d) => d.data),

        /*======================================================================
         * Filler stuff
         */
        getAllFillersInfo: async () => {
            const f = await $http.get("/api/fillers");
            return f.data;
        },

        getFiller: async (id) => {
            const f = await $http.get(`/api/filler/${id}`);
            return f.data;
        },

        updateFiller: async (id, filler) =>
            (
                await $http({
                    method: "POST",
                    url: `/api/filler/${id}`,
                    data: angular.toJson(filler),
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        createFiller: async (filler) =>
            (
                await $http({
                    method: "PUT",
                    url: `/api/filler`,
                    data: angular.toJson(filler),
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        deleteFiller: async (id) =>
            (
                await $http({
                    method: "DELETE",
                    url: `/api/filler/${id}`,
                    data: {},
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        getChannelsUsingFiller: async (fillerId) => (await $http.get(`/api/filler/${fillerId}/channels`)).data,

        /*======================================================================
         * Custom Show stuff
         */
        getAllShowsInfo: async () => {
            const f = await $http.get("/api/shows");
            return f.data;
        },

        getShow: async (id) => {
            const f = await $http.get(`/api/show/${id}`);
            return f.data;
        },

        updateShow: async (id, show) =>
            (
                await $http({
                    method: "POST",
                    url: `/api/show/${id}`,
                    data: angular.toJson(show),
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        createShow: async (show) =>
            (
                await $http({
                    method: "PUT",
                    url: `/api/show`,
                    data: angular.toJson(show),
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        deleteShow: async (id) =>
            (
                await $http({
                    method: "DELETE",
                    url: `/api/show/${id}`,
                    data: {},
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                })
            ).data,

        /*======================================================================
         * TV Guide endpoints
         */
        getGuideStatus: async () => {
            const d = await $http({
                method: "GET",
                url: "/api/guide/status",
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },

        getChannelLineup: async (channelNumber, dateFrom, dateTo) => {
            const a = dateFrom.toISOString();
            const b = dateTo.toISOString();
            const d = await $http({
                method: "GET",
                url: `/api/guide/channels/${channelNumber}?dateFrom=${a}&dateTo=${b}`,
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },

        /*======================================================================
         * Channel Tool Services
         */
        calculateTimeSlots: async (programs, schedule) => {
            const d = await $http({
                method: "POST",
                url: "/api/channel-tools/time-slots",
                data: {
                    programs,
                    schedule,
                },
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },

        calculateRandomSlots: async (programs, schedule) => {
            const d = await $http({
                method: "POST",
                url: "/api/channel-tools/random-slots",
                data: {
                    programs,
                    schedule,
                },
                headers: { "Content-Type": "application/json; charset=utf-8" },
            });
            return d.data;
        },

        /*======================================================================
         * Settings
         */
        getAllSettings: async () => {
            const deferred = $q.defer();
            $http({
                method: "GET",
                url: "/api/settings/cache",
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((response) => {
                if (response.status === 200) {
                    deferred.resolve(response.data);
                } else {
                    deferred.reject();
                }
            });

            return deferred.promise;
        },
        putSetting: async (key, value) => {
            console.warn(key, value);
            const deferred = $q.defer();
            $http({
                method: "PUT",
                url: `/api/settings/cache/${key}`,
                data: {
                    value,
                },
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }).then((response) => {
                if (response.status === 200) {
                    deferred.resolve(response.data);
                } else {
                    deferred.reject();
                }
            });

            return deferred.promise;
        },
    };
};
