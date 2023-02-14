import Plex from "../../src/plex.js";

export default function ($http, $window, $interval) {
    const exported = {
        login: async () => {
            const headers = {
                "Accept": "application/json",
                "X-Plex-Product": "dizqueTV",
                "X-Plex-Version": "Plex OAuth",
                "X-Plex-Client-Identifier": "rg14zekk3pa5zp4safjwaa8z",
                "X-Plex-Model": "Plex OAuth",
            };

            return new Promise((resolve, reject) => {
                $http({
                    method: "POST",
                    url: "https://plex.tv/api/v2/pins?strong=true",
                    headers: headers,
                }).then(
                    (res) => {
                        const plexWindowSizes = {
                            width: 800,
                            height: 700,
                        };

                        const plexWindowPosition = {
                            width: window.innerWidth / 2 + plexWindowSizes.width,
                            height: window.innerHeight / 2 - plexWindowSizes.height,
                        };

                        const authModal = $window.open(
                            `https://app.plex.tv/auth/#!?clientID=rg14zekk3pa5zp4safjwaa8z&context[device][version]=Plex OAuth&context[device][model]=Plex OAuth&code=${res.data.code}&context[device][product]=Plex Web`,
                            "_blank",
                            `height=${plexWindowSizes.height}, width=${plexWindowSizes.width}, top=${plexWindowPosition.height}, left=${plexWindowPosition.width}`,
                        );
                        let limit = 120000; // 2 minute time out limit
                        const poll = 2000; // check every 2 seconds for token
                        const interval = $interval(() => {
                            $http({
                                method: "GET",
                                url: `https://plex.tv/api/v2/pins/${res.data.id}`,
                                headers: headers,
                            }).then(
                                async (r2) => {
                                    limit -= poll;
                                    if (limit <= 0) {
                                        $interval.cancel(interval);
                                        if (authModal) {
                                            authModal.close();
                                        }
                                        reject("Timed Out. Failed to sign in a timely manner (2 mins)");
                                    }
                                    if (r2.data.authToken !== null) {
                                        $interval.cancel(interval);
                                        if (authModal) {
                                            authModal.close();
                                        }

                                        headers["X-Plex-Token"] = r2.data.authToken;

                                        $http({
                                            method: "GET",
                                            url: "https://plex.tv/api/v2/resources?includeHttps=1",
                                            headers: headers,
                                        })
                                            .then((r3) => {
                                                const res_servers = [];

                                                const servers = r3.data;

                                                servers.forEach((server) => {
                                                    // not pms, skip
                                                    if (server.provides != `server`) return;

                                                    res_servers.push(server);
                                                });

                                                res.servers = res_servers;
                                                resolve(res);
                                            })
                                            .catch((err) => {
                                                reject(err);
                                            });
                                    }
                                },
                                (err) => {
                                    $interval.cancel(interval);
                                    if (authModal) {
                                        authModal.close();
                                    }
                                    reject(err);
                                },
                            );
                        }, poll);
                    },
                    (err) => {
                        reject(err);
                    },
                );
            });
        },

        check: async (server) => {
            const client = new Plex(server);
            try {
                const res = await client.Get("/");
                return 1;
            } catch (err) {
                console.error(err);
                return -1;
            }
        },

        getLibrary: async (server) => {
            const client = new Plex(server);
            const res = await client.Get("/library/sections");
            const sections = [];
            for (let i = 0, l = typeof res.Directory !== "undefined" ? res.Directory.length : 0; i < l; i++)
                if (
                    res.Directory[i].type === "movie" ||
                    res.Directory[i].type === "show" ||
                    res.Directory[i].type === "artist"
                ) {
                    const genres = [];
                    if (res.Directory[i].type === "movie") {
                        const genresRes = await client.Get(`/library/sections/${res.Directory[i].key}/genre`);
                        for (
                            let q = 0, k = typeof genresRes.Directory !== "undefined" ? genresRes.Directory.length : 0;
                            q < k;
                            q++
                        ) {
                            if (genresRes.Directory[q].type === "genre") {
                                genres.push({
                                    title: "Genre: " + genresRes.Directory[q].title,
                                    key: genresRes.Directory[q].fastKey,
                                    type: "genre",
                                });
                            }
                        }
                    }

                    sections.push({
                        title: res.Directory[i].title,
                        key: `/library/sections/${res.Directory[i].key}/all`,
                        icon: `${server.uri}${res.Directory[i].composite}?X-Plex-Token=${server.accessToken}`,
                        type: res.Directory[i].type,
                        genres: genres,
                    });
                }
            return sections;
        },
        getPlaylists: async (server) => {
            const client = new Plex(server);
            const res = await client.Get("/playlists");
            const playlists = [];
            for (let i = 0, l = typeof res.Metadata !== "undefined" ? res.Metadata.length : 0; i < l; i++)
                if (res.Metadata[i].playlistType === "video" || res.Metadata[i].playlistType === "audio") {
                    playlists.push({
                        title: res.Metadata[i].title,
                        key: res.Metadata[i].key,
                        icon: `${server.uri}${res.Metadata[i].composite}?X-Plex-Token=${server.accessToken}`,
                        duration: res.Metadata[i].duration,
                    });
                }
            return playlists;
        },
        getStreams: async (server, key) => {
            const client = new Plex(server);
            return client.Get(key).then((res) => {
                const streams = res.Metadata[0].Media[0].Part[0].Stream;
                for (let i = 0, l = streams.length; i < l; i++) {
                    if (typeof streams[i].key !== "undefined") {
                        streams[i].key = `${server.uri}${streams[i].key}?X-Plex-Token=${server.accessToken}`;
                    }
                }
                return streams;
            });
        },
        getNested: async (server, lib, includeCollections, errors) => {
            const client = new Plex(server);
            const key = lib.key;
            const res = await client.Get(key);

            const size = typeof res.Metadata !== "undefined" ? res.Metadata.length : 0;
            let nested = [];
            if (typeof lib.genres !== "undefined") {
                nested = Array.from(lib.genres);
            }
            const seenFiles = {};

            let albumKeys = {};
            const albums = {};
            for (let i = 0; i < size; i++) {
                const meta = res.Metadata[i];
                if (meta.type === "track") {
                    albumKeys[meta.parentKey] = false;
                }
            }
            albumKeys = Object.keys(albumKeys);
            await Promise.all(
                albumKeys.map(async (albumKey) => {
                    try {
                        let album = await client.Get(albumKey);
                        if (typeof album !== "undefined" && album.size == 1) {
                            album = album.Metadata[0];
                        }
                        albums[albumKey] = album;
                    } catch (err) {
                        console.error(err);
                    }
                }),
            );

            for (let i = 0; i < size; i++) {
                try {
                    // Skip any videos (movie or episode) without a duration set...
                    if (
                        typeof res.Metadata[i].duration === "undefined" &&
                        (res.Metadata[i].type === "episode" || res.Metadata[i].type === "movie")
                    )
                        continue;
                    if (
                        res.Metadata[i].duration <= 0 &&
                        (res.Metadata[i].type === "episode" || res.Metadata[i].type === "movie")
                    )
                        continue;
                    let year = res.Metadata[i].year;
                    let date = res.Metadata[i].originallyAvailableAt;
                    let album = undefined;
                    if (res.Metadata[i].type === "track") {
                        // complete album year and date
                        album = albums[res.Metadata[i].parentKey];
                        if (typeof album !== "undefined") {
                            year = album.year;
                            date = album.originallyAvailableAt;
                        }
                    }
                    if (typeof date === "undefined" && typeof year !== "undefined") {
                        date = `${year}-01-01`;
                    }
                    const program = {
                        title: res.Metadata[i].title,
                        key: res.Metadata[i].key,
                        ratingKey: res.Metadata[i].ratingKey,
                        server: server,
                        icon: `${server.uri}${res.Metadata[i].thumb}?X-Plex-Token=${server.accessToken}`,
                        type: res.Metadata[i].type,
                        duration: res.Metadata[i].duration,
                        durationStr: msToTime(res.Metadata[i].duration),
                        subtitle: res.Metadata[i].subtitle,
                        summary: res.Metadata[i].summary,
                        rating: res.Metadata[i].contentRating,
                        date: date,
                        year: year,
                    };
                    if (program.type === "episode" || program.type === "movie" || program.type === "track") {
                        program.plexFile = `${res.Metadata[i].Media[0].Part[0].key}`;
                        program.file = `${res.Metadata[i].Media[0].Part[0].file}`;
                    }
                    if (program.type === "episode") {
                        // Make sure that video files that contain multiple episodes are only listed once:
                        let anyNewFile = false;
                        for (let j = 0; j < res.Metadata[i].Media.length; j++) {
                            for (let k = 0; k < res.Metadata[i].Media[j].Part.length; k++) {
                                const fileName = res.Metadata[i].Media[j].Part[k].file;
                                if (seenFiles[fileName] !== true) {
                                    seenFiles[fileName] = true;
                                    anyNewFile = true;
                                }
                            }
                        }
                        if (!anyNewFile) {
                            continue;
                        }
                        program.showTitle = res.Metadata[i].grandparentTitle;
                        program.episode = res.Metadata[i].index;
                        program.season = res.Metadata[i].parentIndex;
                        program.icon = `${server.uri}${res.Metadata[i].grandparentThumb}?X-Plex-Token=${server.accessToken}`;
                        program.episodeIcon = `${server.uri}${res.Metadata[i].thumb}?X-Plex-Token=${server.accessToken}`;
                        program.seasonIcon = `${server.uri}${res.Metadata[i].parentThumb}?X-Plex-Token=${server.accessToken}`;
                        program.showIcon = `${server.uri}${res.Metadata[i].grandparentThumb}?X-Plex-Token=${server.accessToken}`;
                    } else if (program.type === "track") {
                        if (typeof album !== "undefined") {
                            program.showTitle = album.title;
                        } else {
                            program.showTitle = res.Metadata[i].title;
                        }
                        program.episode = res.Metadata[i].index;
                        program.season = res.Metadata[i].parentIndex;
                    } else if (program.type === "movie") {
                        program.showTitle = res.Metadata[i].title;
                        program.episode = 1;
                        program.season = 1;
                    }
                    nested.push(program);
                } catch (err) {
                    const msg = "Error when attempting to read nested data for " + key + " " + res.Metadata[i].title;
                    errors.push(msg);
                    console.error(msg, err);
                }
            }
            if (includeCollections === true && res.viewGroup !== "artist") {
                let k = res.librarySectionID;

                k = `/library/sections/${k}/collections`;
                const collections = await client.Get(k);
                if (typeof collections.Metadata === "undefined") {
                    collections.Metadata = [];
                }
                const directories = collections.Metadata;
                const nestedCollections = [];
                for (let i = 0; i < directories.length; i++) {
                    let title;
                    if (res.viewGroup === "show") {
                        title = directories[i].title + " Collection";
                    } else {
                        title = directories[i].title;
                    }

                    nestedCollections.push({
                        key: directories[i].key,
                        title: title,
                        type: "collection",
                        collectionType: res.viewGroup,
                    });
                }
                nested = nestedCollections.concat(nested);
            }

            return nested;
        },
    };
    return exported;
}

function msToTime(duration) {
    const milliseconds = parseInt((duration % 1000) / 100);
    let seconds = Math.floor((duration / 1000) % 60);
    let minutes = Math.floor((duration / (1000 * 60)) % 60);
    let hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    hours = hours < 10 ? "0" + hours : hours;
    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;

    return hours + ":" + minutes + ":" + seconds + "." + milliseconds;
}
