import { SLACK } from "../constants.js";
import { getShowData } from "./get-show-data.js";
import { random } from "../helperFuncs.js";
import throttle from "./throttle.js";
import { getShowShuffler, getShowOrderer } from "./show-orderers.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const LIMIT = 40000;

function getShow(program) {
    const d = getShowData(program);
    if (!d.hasShow) {
        return null;
    } else {
        d.description = d.showDisplayName;
        d.id = d.showId;
        return d;
    }
}

function getProgramId(program) {
    let s = program.serverKey;
    if (typeof s === "undefined") {
        s = "unknown";
    }
    let p = program.key;
    if (typeof p === "undefined") {
        p = "unknown";
    }
    return s + "|" + p;
}

function addProgramToShow(show, program) {
    if (show.id == "flex." || show.id.startsWith("redirect.")) {
        // nothing to do
        return;
    }
    const id = getProgramId(program);
    if (show.programs[id] !== true) {
        show.programs.push(program);
        show.programs[id] = true;
    }
}

export default async (programs, schedule) => {
    if (!Array.isArray(programs)) {
        return { userError: "Expected a programs array" };
    }
    if (typeof schedule === "undefined") {
        return { userError: "Expected a schedule" };
    }
    // verify that the schedule is in the correct format
    if (!Array.isArray(schedule.slots)) {
        return { userError: 'Expected a "slots" array in schedule' };
    }
    if (typeof schedule.period === "undefined") {
        schedule.period = DAY;
    }
    for (let i = 0; i < schedule.slots.length; i++) {
        if (typeof schedule.slots[i].duration === "undefined") {
            return { userError: "Each slot should have a duration" };
        }
        if (typeof schedule.slots[i].showId === "undefined") {
            return { userError: "Each slot should have a showId" };
        }
        if (schedule.slots[i].duration <= 0 || Math.floor(schedule.slots[i].duration) != schedule.slots[i].duration) {
            return { userError: "Slot duration should be a integer number of milliseconds greater than 0" };
        }
        if (isNaN(schedule.slots[i].cooldown)) {
            schedule.slots[i].cooldown = 0;
        }
        if (isNaN(schedule.slots[i].weight)) {
            schedule.slots[i].weight = 1;
        }
    }
    if (typeof schedule.pad === "undefined") {
        return { userError: "Expected schedule.pad" };
    }
    if (typeof schedule.maxDays == "undefined") {
        return { userError: "schedule.maxDays must be defined." };
    }
    if (typeof schedule.flexPreference === "undefined") {
        schedule.flexPreference = "distribute";
    }
    if (typeof schedule.padStyle === "undefined") {
        schedule.padStyle = "slot";
    }
    if (schedule.padStyle !== "slot" && schedule.padStyle !== "episode") {
        return { userError: `Invalid schedule.padStyle value: "${schedule.padStyle}"` };
    }
    const flexBetween = schedule.flexPreference !== "end";

    const showsById = {};
    const shows = [];

    function getNextForSlot(slot, remaining) {
        // remaining doesn't restrict what next show is picked. It is only used
        // for shows with flexible length (flex and redirects)
        if (slot.showId === "flex.") {
            return {
                isOffline: true,
                duration: remaining,
            };
        }
        const show = shows[showsById[slot.showId]];
        if (slot.showId.startsWith("redirect.")) {
            return {
                isOffline: true,
                type: "redirect",
                duration: remaining,
                channel: show.channel,
            };
        } else if (slot.order === "shuffle") {
            return getShowShuffler(show).current();
        } else if (slot.order === "next") {
            return getShowOrderer(show).current();
        }
    }

    function advanceSlot(slot) {
        if (slot.showId === "flex." || slot.showId.startsWith("redirect")) {
            return;
        }
        const show = shows[showsById[slot.showId]];
        if (slot.order === "shuffle") {
            return getShowShuffler(show).next();
        } else if (slot.order === "next") {
            return getShowOrderer(show).next();
        }
    }

    function makePadded(item) {
        let padOption = schedule.pad;
        if (schedule.padStyle === "slot") {
            padOption = 1;
        }
        const x = item.duration;
        const m = x % padOption;
        let f = 0;
        if (m > SLACK && padOption - m > SLACK) {
            f = padOption - m;
        }
        return {
            item: item,
            pad: f,
            totalDuration: item.duration + f,
        };
    }

    // load the programs
    for (let i = 0; i < programs.length; i++) {
        const p = programs[i];
        let show = getShow(p);
        if (show != null) {
            if (typeof showsById[show.id] === "undefined") {
                showsById[show.id] = shows.length;
                shows.push(show);
                show.founder = p;
                show.programs = [];
            } else {
                show = shows[showsById[show.id]];
            }
            addProgramToShow(show, p);
        }
    }

    const s = schedule.slots;
    const ts = new Date().getTime();

    const t0 = ts;
    const p = [];
    let t = t0;

    const hardLimit = t0 + schedule.maxDays * DAY;

    const pushFlex = (d) => {
        if (d > 0) {
            t += d;
            if (p.length > 0 && p[p.length - 1].isOffline && p[p.length - 1].type != "redirect") {
                p[p.length - 1].duration += d;
            } else {
                p.push({
                    duration: d,
                    isOffline: true,
                });
            }
        }
    };

    const pushProgram = (item) => {
        if (item.isOffline && item.type !== "redirect") {
            pushFlex(item.duration);
        } else {
            p.push(item);
            t += item.duration;
        }
    };

    const slotLastPlayed = {};

    while (t < hardLimit && p.length < LIMIT) {
        await throttle();
        // ensure t is padded
        const m = t % schedule.pad;
        if (t % schedule.pad > SLACK && schedule.pad - m > SLACK) {
            pushFlex(schedule.pad - m);
            continue;
        }

        let slot = null;
        let slotIndex = null;
        let remaining = null;

        let n = 0;
        let minNextTime = t + 24 * DAY;
        for (let i = 0; i < s.length; i++) {
            if (typeof slotLastPlayed[i] !== undefined) {
                const lastt = slotLastPlayed[i];
                minNextTime = Math.min(minNextTime, lastt + s[i].cooldown);
                if (t - lastt < s[i].cooldown - SLACK) {
                    continue;
                }
            }
            n += s[i].weight;
            if (random.bool(s[i].weight, n)) {
                slot = s[i];
                slotIndex = i;
                remaining = s[i].duration;
            }
        }
        if (slot == null) {
            // Nothing to play, likely due to cooldown
            pushFlex(minNextTime - t);
            continue;
        }
        const item = getNextForSlot(slot, remaining);

        if (item.isOffline) {
            // flex or redirect. We can just use the whole duration
            item.duration = remaining;
            pushProgram(item);
            slotLastPlayed[slotIndex] = t;
            continue;
        }
        if (item.duration > remaining) {
            // Slide
            pushProgram(item);
            slotLastPlayed[slotIndex] = t;
            advanceSlot(slot);
            continue;
        }

        const padded = makePadded(item);
        let total = padded.totalDuration;
        advanceSlot(slot);
        const pads = [padded];

        while (true) {
            const item2 = getNextForSlot(slot);
            if (total + item2.duration > remaining) {
                break;
            }
            const padded2 = makePadded(item2);
            pads.push(padded2);
            advanceSlot(slot);
            total += padded2.totalDuration;
        }
        const temt = t + total;
        let rem = 0;
        if (temt % schedule.pad >= SLACK && temt % schedule.pad < schedule.pad - SLACK) {
            rem = schedule.pad - (temt % schedule.pad);
        }

        if (flexBetween && schedule.padStyle === "episode") {
            const div = Math.floor(rem / schedule.pad);
            const mod = rem % schedule.pad;
            // add mod to the latest item
            pads[pads.length - 1].pad += mod;
            pads[pads.length - 1].totalDuration += mod;

            const sortedPads = pads.map((p, $index) => {
                return {
                    pad: p.pad,
                    index: $index,
                };
            });
            sortedPads.sort((a, b) => {
                return a.pad - b.pad;
            });
            for (let i = 0; i < pads.length; i++) {
                let q = Math.floor(div / pads.length);
                if (i < div % pads.length) {
                    q++;
                }
                const j = sortedPads[i].index;
                pads[j].pad += q * schedule.pad;
            }
        } else if (flexBetween) {
            // just distribute it equitatively
            const div = Math.floor(rem / pads.length);
            let totalAdded = 0;
            for (let i = 0; i < pads.length; i++) {
                pads[i].pad += div;
                totalAdded += div;
            }
            pads[0].pad += rem - totalAdded;
        } else {
            // also add div to the latest item
            pads[pads.length - 1].pad += rem;
            pads[pads.length - 1].totalDuration += rem;
        }
        // now unroll them all
        for (let i = 0; i < pads.length; i++) {
            pushProgram(pads[i].item);
            slotLastPlayed[slotIndex] = t;
            pushFlex(pads[i].pad);
        }
    }
    while (t > hardLimit || p.length >= LIMIT) {
        t -= p.pop().duration;
    }
    const m = (t - t0) % schedule.period;
    if (m != 0) {
        // ensure the schedule is a multiple of period
        pushFlex(schedule.period - m);
    }

    return {
        programs: p,
        startTime: new Date(t0).toISOString(),
    };
};
