"use strict";

const express = require("express");

function redirectRouter(db) {
    const router = express.Router();

    router.get("/plex/media", (req, res) => {
        const serverKey = req.query.server;

        let server = db["plex-servers"].find({ name: serverKey });
        if (server.length == 0) {
            throw Error(`Unable to find server "${serverKey}" specified by program.`);
        }
        server = server[0];
        if (server.uri.endsWith("/")) {
            server.uri = server.uri.slice(0, server.uri.length - 1);
        }

        const url = new URL(server.uri);
        url.pathname = req.query.url;
        url.search = "";
        url.searchParams.append("X-Plex-Token", server.accessToken);

        res.redirect(url);
    });

    return router;
}

module.exports = { redirectRouter };
