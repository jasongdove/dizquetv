"use strict";

const { spawn } = require("child_process");
const events = require("events");
const {
    HardwareAccelerationMode,
    CommandGenerator,
    VideoInputFile,
    AudioInputFile,
    VideoStream,
    AudioStream,
    FFmpegState,
    FrameState,
    VideoFormat,
    FrameSize,
    AudioState,
    PipelineBuilderFactory,
    PixelFormatYuv420p,
    PixelFormatYuv420p10Le,
} = require("@jasongdove/ffmpeg-pipeline");

const MAXIMUM_ERROR_DURATION_MS = 60000;
const REALLY_RIDICULOUSLY_HIGH_FPS_FOR_DIZQUETVS_USECASE = 120;

class FFMPEG extends events.EventEmitter {
    constructor(opts, channel) {
        super();
        this.opts = opts;
        this.errorPicturePath = `http://localhost:${process.env.PORT}/images/generic-error-screen.png`;
        this.ffmpegName = "unnamed ffmpeg";
        if (!this.opts.enableFFMPEGTranscoding) {
            // this ensures transcoding is completely disabled even if
            // some settings are true
            this.opts.normalizeAudio = false;
            this.opts.normalizeAudioCodec = false;
            this.opts.normalizeVideoCodec = false;
            this.opts.errorScreen = "kill";
            this.opts.normalizeResolution = false;
            this.opts.audioVolumePercent = 100;
            this.opts.maxFPS = REALLY_RIDICULOUSLY_HIGH_FPS_FOR_DIZQUETVS_USECASE;
        }
        this.channel = channel;
        this.ffmpegPath = opts.ffmpegPath;

        let resString = opts.targetResolution;
        if (
            typeof channel.transcoding !== "undefined" &&
            channel.transcoding.targetResolution !== null &&
            typeof channel.transcoding.targetResolution !== "undefined" &&
            channel.transcoding.targetResolution !== ""
        ) {
            resString = channel.transcoding.targetResolution;
        }

        if (
            typeof channel.transcoding !== "undefined" &&
            channel.transcoding.videoBitrate !== null &&
            typeof channel.transcoding.videoBitrate !== "undefined" &&
            channel.transcoding.videoBitrate !== 0
        ) {
            opts.videoBitrate = channel.transcoding.videoBitrate;
        }

        if (
            typeof channel.transcoding !== "undefined" &&
            channel.transcoding.videoBufSize !== null &&
            typeof channel.transcoding.videoBufSize !== "undefined" &&
            channel.transcoding.videoBufSize !== 0
        ) {
            opts.videoBufSize = channel.transcoding.videoBufSize;
        }

        const parsed = parseResolutionString(resString);
        this.wantedW = parsed.w;
        this.wantedH = parsed.h;

        this.sentData = false;
        this.apad = this.opts.normalizeAudio;
        this.audioChannelsSampleRate = this.opts.normalizeAudio;
        this.ensureResolution = this.opts.normalizeResolution;
        this.volumePercent = this.opts.audioVolumePercent;
        this.hasBeenKilled = false;
        this.audioOnly = false;
    }

    setAudioOnly(audioOnly) {
        this.audioOnly = audioOnly;
    }

    async spawnConcat(streamUrl) {
        return this.spawn(false, streamUrl, undefined, undefined, undefined, true, false, undefined, true);
    }

    async spawnStream(directPlay, streamUrl, streamStats, startTime, duration, enableIcon, lineupItem) {
        return this.spawn(directPlay, streamUrl, streamStats, startTime, duration, true, enableIcon, lineupItem, false);
    }

    async spawnError(title, subtitle, duration) {
        if (!this.opts.enableFFMPEGTranscoding || this.opts.errorScreen === "kill") {
            console.error("error: " + title + " ; " + subtitle);
            this.emit("error", { code: -1, cmd: `error stream disabled. ${title} ${subtitle}` });
            return;
        }
        if (typeof duration === "undefined") {
            // set a place-holder duration
            console.log("No duration found for error stream, using placeholder");
            duration = MAXIMUM_ERROR_DURATION_MS;
        }
        duration = Math.min(MAXIMUM_ERROR_DURATION_MS, duration);
        const streamStats = {
            videoWidth: this.wantedW,
            videoHeight: this.wantedH,
            duration,
        };
        return this.spawn(
            false,
            { errorTitle: title, subtitle },
            streamStats,
            undefined,
            `${streamStats.duration}ms`,
            true,
            false,
            "error",
            false,
        );
    }

    async spawnOffline(duration) {
        if (!this.opts.enableFFMPEGTranscoding) {
            console.log(
                "The channel has an offline period scheduled for this time slot. FFMPEG transcoding is disabled, so it is not possible to render an offline screen. Ending the stream instead",
            );
            this.emit("end", { code: -1, cmd: `offline stream disabled.` });
            return;
        }

        const streamStats = {
            videoWidth: this.wantedW,
            videoHeight: this.wantedH,
            duration,
        };
        return this.spawn(
            false,
            { errorTitle: "offline" },
            streamStats,
            undefined,
            `${duration}ms`,
            true,
            false,
            "offline",
            false,
        );
    }

    async spawn(directPlay, streamUrl, streamStats, startTime, duration, limitRead, watermark, lineupItem, isConcatPlaylist) {
        const ffmpegArgs = [];

        if (!isConcatPlaylist) {
            ffmpegArgs.push("-threads", this.opts.threads);
        }

        ffmpegArgs.push("-fflags", "+genpts+discardcorrupt+igndts");
        let stillImage = false;

        if (limitRead === true && (this.audioOnly !== true || typeof streamUrl.errorTitle === "undefined")) {
            ffmpegArgs.push(`-re`);
        }

        if (typeof startTime !== "undefined") ffmpegArgs.push(`-ss`, startTime);

        if (isConcatPlaylist === true)
            ffmpegArgs.push(`-f`, `concat`, `-safe`, `0`, `-protocol_whitelist`, `file,http,tcp,https,tcp,tls`);

        // Map correct audio index. '?' so doesn't fail if no stream available.
        const audioIndex = typeof streamStats === "undefined" ? "a" : `${streamStats.audioIndex}`;

        // TODO: Do something about missing audio stream
        if (!isConcatPlaylist) {
            let inputFiles = 0;
            let audioFile = -1;
            let videoFile = -1;
            let overlayFile = -1;
            if (typeof streamUrl.errorTitle === "undefined") {
                ffmpegArgs.push(`-i`, streamUrl);
                videoFile = inputFiles++;
                audioFile = videoFile;
            }

            // When we have an individual stream, there is a pipeline of possible
            // filters to apply.
            //
            let doOverlay = typeof watermark === "undefined" || watermark !== null;
            let iW = streamStats.videoWidth;
            let iH = streamStats.videoHeight;

            // (explanation is the same for the video and audio streams)
            // The initial stream is called '[video]'
            let currentVideo = "[video]";
            let currentAudio = "[audio]";
            // Initially, videoComplex does nothing besides assigning the label
            // to the input stream
            const videoIndex = "v";
            let audioComplex = `;[${audioFile}:${audioIndex}]anull[audio]`;
            let videoComplex = `;[${videoFile}:${videoIndex}]null[video]`;
            // Depending on the options we will apply multiple filters
            // each filter modifies the current video stream. Adds a filter to
            // the videoComplex variable. The result of the filter becomes the
            // new currentVideo value.
            //
            // When adding filters, make sure that
            // videoComplex always begins wiht ; and doesn't end with ;

            if (streamStats.videoFramerate >= this.opts.maxFPS + 0.000001) {
                videoComplex += `;${currentVideo}fps=${this.opts.maxFPS}[fpchange]`;
                currentVideo = "[fpchange]";
            }

            // deinterlace if desired
            if (streamStats.videoScanType === "interlaced" && this.opts.deinterlaceFilter !== "none") {
                videoComplex += `;${currentVideo}${this.opts.deinterlaceFilter}[deinterlaced]`;
                currentVideo = "[deinterlaced]";
            }

            // prepare input streams
            if (typeof streamUrl.errorTitle !== "undefined" || streamStats.audioOnly) {
                doOverlay = false; // never show icon in the error screen
                // for error stream, we have to generate the input as well
                this.apad = false; // all of these generate audio correctly-aligned to video so there is no need for apad
                this.audioChannelsSampleRate = true; // we'll need these

                // all the error strings already choose the resolution to
                // match iW x iH , so with this we save ourselves a second
                // scale filter
                iW = this.wantedW;
                iH = this.wantedH;

                if (this.audioOnly !== true) {
                    ffmpegArgs.push("-r", "24");
                    let pic = null;

                    // does an image to play exist?
                    if (typeof streamUrl.errorTitle === "undefined" && streamStats.audioOnly) {
                        pic = streamStats.placeholderImage;
                    } else if (streamUrl.errorTitle === "offline") {
                        pic = `${this.channel.offlinePicture}`;
                    } else if (this.opts.errorScreen === "pic") {
                        pic = `${this.errorPicturePath}`;
                    }

                    if (pic !== null) {
                        // force software encoders for loading screen
                        if (this.opts.videoEncoder.includes("hevc_")) {
                            this.opts.videoEncoder = "libx265";
                        } else if (this.opts.videoEncoder.includes("h264_")) {
                            this.opts.videoEncoder = "libx264";
                        } else if (this.opts.videoEncoder.includes("mpeg2_")) {
                            this.opts.videoEncoder = "mpeg2video";
                        }

                        ffmpegArgs.push("-i", pic);
                        if (typeof duration === "undefined" && typeof streamStats.duration !== "undefined") {
                            // add 150 milliseconds just in case, exact duration seems to cut out the last bits of music some times.
                            duration = `${streamStats.duration + 150}ms`;
                        }
                        videoComplex = `;[${inputFiles++}:0]format=yuv420p[formatted]`;
                        videoComplex += `;[formatted]scale=w=${iW}:h=${iH}:force_original_aspect_ratio=1[scaled]`;
                        videoComplex += `;[scaled]pad=${iW}:${iH}:(ow-iw)/2:(oh-ih)/2[padded]`;
                        videoComplex += `;[padded]loop=loop=-1:size=1:start=0[looped]`;
                        videoComplex += `;[looped]realtime[videox]`;

                        // this tune apparently makes the video compress better
                        // when it is the same image
                        stillImage = true;
                    } else if (this.opts.errorScreen === "static") {
                        ffmpegArgs.push("-f", "lavfi", "-i", `nullsrc=s=64x36`);
                        videoComplex = `;geq=random(1)*255:128:128[videoz];[videoz]scale=${iW}:${iH}[videoy];[videoy]realtime[videox]`;
                        inputFiles++;
                    } else if (this.opts.errorScreen === "testsrc") {
                        ffmpegArgs.push("-f", "lavfi", "-i", `testsrc=size=${iW}x${iH}`);
                        videoComplex = `;realtime[videox]`;
                        inputFiles++;
                    } else if (this.opts.errorScreen === "text") {
                        const sz2 = Math.ceil(iH / 33.0);
                        const sz1 = Math.ceil((sz2 * 3) / 2);
                        const sz3 = 2 * sz2;

                        ffmpegArgs.push("-f", "lavfi", "-i", `color=c=black:s=${iW}x${iH}`);
                        inputFiles++;

                        videoComplex = `;drawtext=fontfile=${process.env.DATABASE}/font.ttf:fontsize=${sz1}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:text='${streamUrl.errorTitle}',drawtext=fontfile=${process.env.DATABASE}/font.ttf:fontsize=${sz2}:fontcolor=white:x=(w-text_w)/2:y=(h+text_h+${sz3})/2:text='${streamUrl.subtitle}'[videoy];[videoy]realtime[videox]`;
                    } else {
                        // blank
                        ffmpegArgs.push("-f", "lavfi", "-i", `color=c=black:s=${iW}x${iH}`);
                        inputFiles++;
                        videoComplex = `;realtime[videox]`;
                    }
                }
                const durstr = `duration=${streamStats.duration}ms`;
                if (typeof streamUrl.errorTitle !== "undefined") {
                    // silent
                    audioComplex = `;aevalsrc=0:${durstr}[audioy]`;
                    if (streamUrl.errorTitle === "offline") {
                        if (
                            typeof this.channel.offlineSoundtrack !== "undefined" &&
                            this.channel.offlineSoundtrack !== ""
                        ) {
                            ffmpegArgs.push("-i", `${this.channel.offlineSoundtrack}`);
                            // I don't really understand why, but you need to use this
                            // 'size' in order to make the soundtrack actually loop
                            audioComplex = `;[${inputFiles++}:a]aloop=loop=-1:size=2147483647[audioy]`;
                        }
                    } else if (
                        this.opts.errorAudio === "whitenoise" ||
                        (!(this.opts.errorAudio === "sine") && this.audioOnly === true) // when it's in audio-only mode, silent stream is confusing for errors.
                    ) {
                        audioComplex = `;aevalsrc=random(0):${durstr}[audioy]`;
                        this.volumePercent = Math.min(70, this.volumePercent);
                    } else if (this.opts.errorAudio === "sine") {
                        audioComplex = `;sine=f=440:${durstr}[audioy]`;
                        this.volumePercent = Math.min(70, this.volumePercent);
                    }
                    if (this.audioOnly !== true) {
                        ffmpegArgs.push("-pix_fmt", "yuv420p");
                    }
                    audioComplex += ";[audioy]arealtime[audiox]";
                    currentAudio = "[audiox]";
                }
                currentVideo = "[videox]";
            }
            if (doOverlay) {
                if (watermark.animated === true) {
                    ffmpegArgs.push("-ignore_loop", "0");
                }
                ffmpegArgs.push(`-i`, `${watermark.url}`);
                overlayFile = inputFiles++;
                this.ensureResolution = true;
            }

            // Resolution fix: Add scale filter, current stream becomes [siz]
            const beforeSizeChange = currentVideo;
            const algo = this.opts.scalingAlgorithm;
            let resizeMsg = "";
            if (
                !streamStats.audioOnly &&
                ((this.ensureResolution && (streamStats.anamorphic || iW !== this.wantedW || iH !== this.wantedH)) ||
                    isLargerResolution(iW, iH, this.wantedW, this.wantedH))
            ) {
                // scaler stuff, need to change the size of the video and also add bars
                // calculate wanted aspect ratio
                let p = iW * streamStats.pixelP;
                let q = iH * streamStats.pixelQ;
                const g = gcd(q, p); // and people kept telling me programming contests knowledge had no use real programming!
                p = Math.floor(p / g);
                q = Math.floor(q / g);
                const hypotheticalW1 = this.wantedW;
                const hypotheticalH1 = Math.floor((hypotheticalW1 * q) / p);
                const hypotheticalH2 = this.wantedH;
                const hypotheticalW2 = Math.floor((this.wantedH * p) / q);
                let cw;
                let ch;
                if (hypotheticalH1 <= this.wantedH) {
                    cw = hypotheticalW1;
                    ch = hypotheticalH1;
                } else {
                    cw = hypotheticalW2;
                    ch = hypotheticalH2;
                }
                videoComplex += `;${currentVideo}scale=${cw}:${ch}:flags=${algo}[scaled]`;
                currentVideo = "scaled";
                resizeMsg = `Stretch to ${cw} x ${ch}. To fit target resolution of ${this.wantedW} x ${this.wantedH}.`;
                if (this.ensureResolution) {
                    console.log(
                        `First stretch to ${cw} x ${ch}. Then add padding to make it ${this.wantedW} x ${this.wantedH} `,
                    );
                } else if (cw % 2 === 1 || ch % 2 === 1) {
                    // we need to add padding so that the video dimensions are even
                    const xw = cw + (cw % 2);
                    const xh = ch + (ch % 2);
                    resizeMsg = `Stretch to ${cw} x ${ch}. To fit target resolution of ${this.wantedW} x ${this.wantedH}. Then add 1 pixel of padding so that dimensions are not odd numbers, because they are frowned upon. The final resolution will be ${xw} x ${xh}`;
                    this.wantedW = xw;
                    this.wantedH = xh;
                } else {
                    resizeMsg = `Stretch to ${cw} x ${ch}. To fit target resolution of ${this.wantedW} x ${this.wantedH}.`;
                }
                if (this.wantedW !== cw || this.wantedH !== ch) {
                    // also add black bars, because in this case it HAS to be this resolution
                    videoComplex += `;[${currentVideo}]pad=${this.wantedW}:${this.wantedH}:(ow-iw)/2:(oh-ih)/2[blackpadded]`;
                    currentVideo = "blackpadded";
                }
                let name = "siz";
                if (!this.ensureResolution && beforeSizeChange !== "[fpchange]") {
                    name = "minsiz";
                }
                videoComplex += `;[${currentVideo}]setsar=1[${name}]`;
                currentVideo = `[${name}]`;
                iW = this.wantedW;
                iH = this.wantedH;
            }

            // Channel watermark:
            if (doOverlay && this.audioOnly !== true) {
                const pW = watermark.width;
                const w = Math.round((pW * iW) / 100.0);
                const mpHorz = watermark.horizontalMargin;
                const mpVert = watermark.verticalMargin;
                const horz = Math.round((mpHorz * iW) / 100.0);
                const vert = Math.round((mpVert * iH) / 100.0);

                const posAry = {
                    "top-left": `x=${horz}:y=${vert}`,
                    "top-right": `x=W-w-${horz}:y=${vert}`,
                    "bottom-left": `x=${horz}:y=H-h-${vert}`,
                    "bottom-right": `x=W-w-${horz}:y=H-h-${vert}`,
                };
                let icnDur = "";
                if (watermark.duration > 0) {
                    icnDur = `:enable='between(t,0,${watermark.duration})'`;
                }
                let waterVideo = `[${overlayFile}:v]`;
                if (!watermark.fixedSize) {
                    videoComplex += `;${waterVideo}scale=${w}:-1[icn]`;
                    waterVideo = "[icn]";
                }
                const p = posAry[watermark.position];
                if (typeof p === "undefined") {
                    throw Error("Invalid watermark position: " + watermark.position);
                }
                let overlayShortest = "";
                if (watermark.animated) {
                    overlayShortest = "shortest=1:";
                }
                videoComplex += `;${currentVideo}${waterVideo}overlay=${overlayShortest}${p}${icnDur}[comb]`;
                currentVideo = "[comb]";
            }

            if (this.volumePercent !== 100) {
                const f = this.volumePercent / 100.0;
                audioComplex += `;${currentAudio}volume=${f}[boosted]`;
                currentAudio = "[boosted]";
            }

            let transcodeAudio =
                this.opts.normalizeAudioCodec && isDifferentAudioCodec(streamStats.audioCodec, this.opts.audioEncoder);

            // Align audio is just the apad filter applied to audio stream
            if (this.apad && this.audioOnly !== true) {
                // it doesn't make much sense to pad audio when there is no video
                audioComplex += `;${currentAudio}apad=whole_dur=${streamStats.duration}ms[padded]`;
                currentAudio = "[padded]";
            } else if (this.audioChannelsSampleRate) {
                // TODO: Do not set this to true if audio channels and sample rate are already good
                transcodeAudio = true;
            }

            // If no filters have been applied, then the stream will still be
            // [video] , in that case, we do not actually add the video stuff to
            // filter_complex and this allows us to avoid transcoding.
            let transcodeVideo =
                this.opts.normalizeVideoCodec && isDifferentVideoCodec(streamStats.videoCodec, this.opts.videoEncoder);
            let filterComplex = "";
            if (!transcodeVideo && currentVideo === "[minsiz]") {
                // do not change resolution if no other transcoding will be done
                // and resolution normalization is off
                currentVideo = beforeSizeChange;
            } else {
                console.log(resizeMsg);
            }
            if (this.audioOnly !== true) {
                if (currentVideo !== "[video]") {
                    // this is useful so that it adds some lines below
                    transcodeVideo = true;
                    filterComplex += videoComplex;
                } else {
                    currentVideo = `${videoFile}:${videoIndex}`;
                }
            }
            // same with audio:
            if (currentAudio !== "[audio]") {
                transcodeAudio = true;
                filterComplex += audioComplex;
            } else {
                currentAudio = `${audioFile}:${audioIndex}`;
            }

            // If there is a filter complex, add it.
            if (filterComplex !== "") {
                ffmpegArgs.push(`-filter_complex`, filterComplex.slice(1));
                if (this.alignAudio) {
                    ffmpegArgs.push("-shortest");
                }
            }
            ffmpegArgs.push("-map", currentAudio);
            if (this.audioOnly !== true) {
                ffmpegArgs.push(
                    "-map",
                    currentVideo,
                    `-c:v`,
                    transcodeVideo ? this.opts.videoEncoder : "copy",
                    `-sc_threshold`,
                    `1000000000`,
                    "-video_track_timescale",
                    "90000",
                );
                // -tune stillimage only applies to libx264
                if (stillImage && this.opts.videoEncoder.toLowerCase() === "libx264") {
                    ffmpegArgs.push("-tune", "stillimage");
                }
            }
            ffmpegArgs.push(`-flags`, `cgop+ilme`);
            if (transcodeVideo && this.audioOnly !== true) {
                // add the video encoder flags
                ffmpegArgs.push(`-maxrate:v`, `${this.opts.videoBitrate}k`, `-bufsize:v`, `${this.opts.videoBufSize}k`);
            }
            if (transcodeAudio) {
                // add the audio encoder flags
                ffmpegArgs.push(
                    `-b:a`,
                    `${this.opts.audioBitrate}k`,
                    `-maxrate:a`,
                    `${this.opts.audioBitrate}k`,
                    `-bufsize:a`,
                    `${this.opts.videoBufSize}k`,
                );
                if (this.audioChannelsSampleRate) {
                    ffmpegArgs.push(`-ac`, `${this.opts.audioChannels}`, `-ar`, `${this.opts.audioSampleRate}k`);
                }
            }
            if (transcodeAudio && transcodeVideo) {
                console.log("Video and Audio are being transcoded by ffmpeg");
            } else if (transcodeVideo) {
                console.log("Video is being transcoded by ffmpeg. Audio is being copied.");
            } else if (transcodeAudio) {
                console.log("Audio is being transcoded by ffmpeg. Video is being copied.");
            } else {
                console.log("Video and Audio are being copied. ffmpeg is not transcoding.");
            }
            ffmpegArgs.push(
                `-c:a`,
                transcodeAudio ? this.opts.audioEncoder : "copy",
                "-map_metadata",
                "-1",
                "-movflags",
                "+faststart",
                `-muxdelay`,
                `0`,
                `-muxpreload`,
                `0`,
            );
        } else {
            // Concat stream is simpler and should always copy the codec
            ffmpegArgs.push(`-probesize`, 32 /* `100000000`*/, `-i`, streamUrl);
            if (this.audioOnly !== true) {
                ffmpegArgs.push(`-map`, `0:v`);
            }
            ffmpegArgs.push(
                `-map`,
                `0:${audioIndex}`,
                `-c`,
                `copy`,
                `-muxdelay`,
                this.opts.concatMuxDelay,
                `-muxpreload`,
                this.opts.concatMuxDelay,
            );
        }

        ffmpegArgs.push(`-metadata`, `service_provider="dizqueTV"`, `-metadata`, `service_name="${this.channel.name}"`);

        // t should be before -f
        if (typeof duration !== "undefined") {
            ffmpegArgs.push(`-t`, `${duration}`);
        }

        ffmpegArgs.push(`-f`, `mpegts`, `pipe:1`);

        if (
            directPlay === true &&
            !isConcatPlaylist &&
            this.audioOnly !== true &&
            typeof streamUrl.errorTitle === "undefined"
        ) {
            const url = new URL(streamUrl);
            // call localhost instead of plex
            url.host = "localhost";
            url.protocol = "http";
            url.port = process.env.PORT;

            // don't include token in this request
            // pathname is used in search, so set it before changing it
            url.search = "";
            url.searchParams.append("server", lineupItem.serverKey);
            url.searchParams.append("url", url.pathname);

            url.pathname = "/plex/media";

            const pixelFormat =
                streamStats.videoBitDepth === 8 ? new PixelFormatYuv420p() : new PixelFormatYuv420p10Le();

            const videoStream = new VideoStream(
                streamStats.videoIndex,
                streamStats.videoCodec,
                pixelFormat,
                new FrameSize(streamStats.videoWidth, streamStats.videoHeight),
                streamStats.anamorphic,
                streamStats.pixelAspectRatio,
            );
            const videoInputFile = new VideoInputFile(url.toString(), new Array(videoStream));

            const audioStream = new AudioStream(
                streamStats.audioIndex,
                streamStats.audioCodec,
                streamStats.audioChannels,
            );
            const desiredAudioState = new AudioState();
            desiredAudioState.audioEncoder = this.opts.audioEncoder;
            desiredAudioState.audioChannels = this.opts.audioChannels;
            desiredAudioState.audioSampleRate = this.opts.audioSampleRate;
            desiredAudioState.audioBitrate = this.opts.audioBitrate;
            desiredAudioState.audioBufferSize = this.opts.audioBufSize;
            if (this.apad) {
                desiredAudioState.audioDuration = streamStats.duration;
            }
            const audioInputFile = new AudioInputFile(url.toString(), new Array(audioStream), desiredAudioState);
            const ffmpegState = new FFmpegState();
            ffmpegState.start = startTime === undefined ? null : `${startTime}`;
            if (typeof duration !== "undefined") {
                ffmpegState.finish = `${duration}`;
            }
            ffmpegState.metadataServiceProvider = "dizqueTV";
            ffmpegState.metadataServiceName = this.channel.name;
            ffmpegState.softwareScalingAlgorithm = this.opts.scalingAlgorithm;
            ffmpegState.softwareDeinterlaceFilter = this.opts.deinterlaceFilter;

            const targetResolution = this.ensureResolution
                ? new FrameSize(this.wantedW, this.wantedH)
                : new FrameSize(streamStats.videoWidth, streamStats.videoHeight);

            const squarePixelFrameSize = videoStream.squarePixelFrameSize(targetResolution);
            const desiredState = new FrameState(squarePixelFrameSize, targetResolution, false);
            desiredState.realtime = true;

            const encoder = this.opts.videoEncoder.toLowerCase();
            if (encoder.includes("264")) {
                desiredState.videoFormat = VideoFormat.H264;
            } else if (encoder.includes("265") || encoder.includes("hevc")) {
                desiredState.videoFormat = VideoFormat.Hevc;
            } else {
                desiredState.videoFormat = VideoFormat.Mpeg2Video;
            }

            desiredState.videoBitrate = this.opts.videoBitrate;
            desiredState.videoBufferSize = this.opts.videoBufSize;
            desiredState.videoTrackTimescale = 90_000;
            desiredState.interlaced =
                streamStats.videoScanType === "interlaced" && this.opts.deinterlaceFilter !== "none";

            // infer hardware acceleration based on encoder
            let accel = HardwareAccelerationMode.None;
            if (encoder.includes("nvenc")) {
                accel = HardwareAccelerationMode.Nvenc;
            } else if (encoder.includes("qsv")) {
                accel = HardwareAccelerationMode.Qsv;
            }

            const builder = PipelineBuilderFactory.getBuilder(accel, videoInputFile, audioInputFile);
            const steps = builder.build(ffmpegState, desiredState).pipelineSteps;

            const result = new CommandGenerator().generateArguments(videoInputFile, steps);
            console.log(result);
            ffmpegArgs.length = 0;
            ffmpegArgs.push(...result);
            console.log(result.join(" "));
        } else {
            console.log("default args...");
            console.log(ffmpegArgs.join(" "));
        }

        const doLogs = this.opts.logFfmpeg && !isConcatPlaylist;
        if (this.hasBeenKilled) {
            return;
        }
        this.ffmpeg = spawn(this.ffmpegPath, ffmpegArgs, {
            stdio: ["ignore", "pipe", doLogs ? process.stderr : "ignore"],
        });
        if (this.hasBeenKilled) {
            console.log("Send SIGKILL to ffmpeg");
            this.ffmpeg.kill("SIGKILL");
            return;
        }

        this.ffmpegName = isConcatPlaylist ? "Concat FFMPEG" : "Stream FFMPEG";

        this.ffmpeg.on("error", (code, signal) => {
            console.log(`${this.ffmpegName} received error event: ${code}, ${signal}`);
        });
        this.ffmpeg.on("exit", (code, signal) => {
            if (code === null) {
                if (!this.hasBeenKilled) {
                    console.log(`${this.ffmpegName} exited due to signal: ${signal}`);
                } else {
                    console.log(`${this.ffmpegName} exited due to signal: ${signal} as expected.`);
                }
                this.emit("close", code);
            } else if (code === 0) {
                console.log(`${this.ffmpegName} exited normally.`);
                this.emit("end");
            } else if (code === 255) {
                if (this.hasBeenKilled) {
                    console.log(`${this.ffmpegName} finished with code 255.`);
                    this.emit("close", code);
                    return;
                }
                if (!this.sentData) {
                    this.emit("error", { code, cmd: `${this.opts.ffmpegPath} ${ffmpegArgs.join(" ")}` });
                }
                console.log(`${this.ffmpegName} exited with code 255.`);
                this.emit("close", code);
            } else {
                console.log(`${this.ffmpegName} exited with code ${code}.`);
                this.emit("error", { code, cmd: `${this.opts.ffmpegPath} ${ffmpegArgs.join(" ")}` });
            }
        });

        return this.ffmpeg.stdout;
    }

    kill() {
        console.log(`${this.ffmpegName} RECEIVED kill() command`);
        this.hasBeenKilled = true;
        if (typeof this.ffmpeg !== "undefined") {
            console.log(`${this.ffmpegName} this.ffmpeg.kill()`);
            this.ffmpeg.kill("SIGKILL");
        }
    }
}

function isDifferentVideoCodec(codec, encoder) {
    if (codec === "mpeg2video") {
        return !encoder.includes("mpeg2");
    } else if (codec === "h264") {
        return !encoder.includes("264");
    } else if (codec === "hevc") {
        return !(encoder.includes("265") || encoder.includes("hevc"));
    }
    // if the encoder/codec combinations are unknown, always encode, just in case
    return true;
}

function isDifferentAudioCodec(codec, encoder) {
    if (codec === "mp3") {
        return !(encoder.includes("mp3") || encoder.includes("lame"));
    } else if (codec === "aac") {
        return !encoder.includes("aac");
    } else if (codec === "ac3") {
        return !encoder.includes("ac3");
    } else if (codec === "flac") {
        return !encoder.includes("flac");
    }
    // if the encoder/codec combinations are unknown, always encode, just in case
    return true;
}

function isLargerResolution(w1, h1, w2, h2) {
    return w1 > w2 || h1 > h2 || w1 % 2 === 1 || h1 % 2 === 1;
}

function parseResolutionString(s) {
    let i = s.indexOf("x");
    if (i === -1) {
        i = s.indexOf("×");
        if (i === -1) {
            return { w: 1920, h: 1080 };
        }
    }
    return {
        w: parseInt(s.substring(0, i), 10),
        h: parseInt(s.substring(i + 1), 10),
    };
}

function gcd(a, b) {
    while (b !== 0) {
        const c = b;
        b = a % b;
        a = c;
    }
    return a;
}

module.exports = FFMPEG;
