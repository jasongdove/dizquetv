const constants = require("../constants");


const getShowData = require("./get-show-data")();
const random = require('../helperFuncs').random;
const throttle = require('./throttle');
const orderers = require("./show-orderers");

const MINUTE = 60*1000;
const DAY = 24*60*MINUTE;
const LIMIT = 40000;


function getShow(program) {

    let d = getShowData(program);
    if (! d.hasShow) {
        return null;
    } else {
        d.description = d.showDisplayName;
        d.id = d.showId;
        return d;
    }
}

function getProgramId(program) {
    let s = program.serverKey;
    if (typeof(s) === 'undefined') {
        s = 'unknown';
    }
    let p = program.key;
    if (typeof(p) === 'undefined') {
        p = 'unknown';
    }
    return s + "|" + p;
}

function addProgramToShow(show, program) {
    if ( (show.id == 'flex.') || show.id.startsWith("redirect.")  ) {
        //nothing to do
        return;
    }
    let id = getProgramId(program)
    if(show.programs[id] !== true) {
        show.programs.push(program);
        show.programs[id] = true
    }
}

module.exports = async( programs, schedule  ) => {
    if (! Array.isArray(programs) ) {
        return { userError: 'Expected a programs array' };
    }
    if (typeof(schedule) === 'undefined') {
        return { userError: 'Expected a schedule' };
    }
    if (typeof(schedule.timeZoneOffset) === 'undefined') {
        return { userError: 'Expected a time zone offset' };
    }
    //verify that the schedule is in the correct format
    if (! Array.isArray(schedule.slots) ) {
        return { userError: 'Expected a "slots" array in schedule' };
    }
    if (typeof(schedule).period === 'undefined') {
        schedule.period = DAY;
    }
    for (let i = 0; i < schedule.slots.length; i++) {
        if (typeof(schedule.slots[i].time) === 'undefined') {
            return { userError: "Each slot should have a time" };
        }
        if (typeof(schedule.slots[i].showId) === 'undefined') {
            return { userError: "Each slot should have a showId" };
        }
        if (
            (schedule.slots[i].time < 0)
            || (schedule.slots[i].time >= schedule.period)
            || (Math.floor(schedule.slots[i].time) != schedule.slots[i].time)
        ) {
            return { userError: "Slot times should be a integer number of milliseconds between 0 and period-1, inclusive" };
        }
        schedule.slots[i].time = ( schedule.slots[i].time  + 10*schedule.period + schedule.timeZoneOffset*MINUTE) % schedule.period;
    }
    schedule.slots.sort( (a,b) => {
        return (a.time - b.time);
    } );
    for (let i = 1; i < schedule.slots.length; i++) {
        if (schedule.slots[i].time == schedule.slots[i-1].time) {
            return { userError: "Slot times should be unique."};
        }
    }
    if (typeof(schedule.pad) === 'undefined') {
        return { userError: "Expected schedule.pad" };
    }

    if (typeof(schedule.lateness) == 'undefined') {
        return { userError: "schedule.lateness must be defined." };
    }
    if (typeof(schedule.maxDays) == 'undefined') {
        return { userError: "schedule.maxDays must be defined." };
    }
    if (typeof(schedule.flexPreference) === 'undefined') {
        schedule.flexPreference = "distribute";
    }
    if (schedule.flexPreference !== "distribute" && schedule.flexPreference !== "end") {
        return { userError: `Invalid schedule.flexPreference value: "${schedule.flexPreference}"` };
    }
    let flexBetween = ( schedule.flexPreference !== "end" );

    // throttle so that the stream is not affected negatively
    let steps = 0;

    let showsById = {};
    let shows = [];

    function getNextForSlot(slot, remaining) {
        //remaining doesn't restrict what next show is picked. It is only used
        //for shows with flexible length (flex and redirects)
        if (slot.showId === "flex.") {
            return {
                isOffline: true,
                duration: remaining,
            }
        }
        let show = shows[ showsById[slot.showId] ];

        if (slot.showId.startsWith("redirect.")) {
            return {
                isOffline: true,
                type: "redirect",
                duration: remaining,
                channel: show.channel,
            }
        } else if (slot.order === 'shuffle') {
            return orderers.getShowShuffler(show).current();
        } else if (slot.order === 'next') {
            return orderers.getShowOrderer(show).current();
        }
    }
    
    function advanceSlot(slot) {
        if ( (slot.showId === "flex.") || (slot.showId.startsWith("redirect.") ) ) {
            return;
        }
        let show = shows[ showsById[slot.showId] ];
        if (slot.order === 'shuffle') {
            return orderers.getShowShuffler(show).next();
        } else if (slot.order === 'next') {
            return orderers.getShowOrderer(show).next();
        }
    }

    function makePadded(item) {
        let x = item.duration;
        let m = x % schedule.pad;
        let f = 0;
        if ( (m > constants.SLACK) && (schedule.pad - m > constants.SLACK) ) {
            f = schedule.pad - m;
        }
        return {
            item: item,
            pad: f,
            totalDuration: item.duration + f,
        }

    }

    // load the programs
    for (let i = 0; i < programs.length; i++) {
        let p = programs[i];
        let show = getShow(p);
        if (show != null) {
            if (typeof(showsById[show.id] ) === 'undefined') {
                showsById[show.id] = shows.length;
                shows.push( show );
                show.founder = p;
                show.programs = [];
            } else {
                show = shows[ showsById[show.id] ];
            }
            addProgramToShow( show, p );
        }
    }

    let s = schedule.slots;
    let ts = (new Date() ).getTime();
    let curr = ts - ts % (schedule.period);
    let t0 = curr + s[0].time;
    let p = [];
    let t = t0;
    let wantedFinish = t % schedule.period;
    let hardLimit = t0 + schedule.maxDays * DAY;

    let pushFlex = (d) => {
        if (d > 0) {
            t += d;
            if ( (p.length > 0) && p[p.length-1].isOffline && (p[p.length-1].type != 'redirect') ) {
                p[p.length-1].duration += d;
            } else {
                p.push( {
                    duration: d,
                    isOffline : true,
                } );
            }
        }
    }

    let pushProgram = (item) => {
        if ( item.isOffline && (item.type !== 'redirect') ) {
            pushFlex(item.duration);
        } else {
            p.push(item);
            t += item.duration;
        }
    };

    if (ts > t0) {
        pushFlex( ts - t0 );
    }
    while ( (t < hardLimit) && (p.length < LIMIT) ) {
        await throttle();
        //ensure t is padded
        let m = t % schedule.pad;
        if ( (t % schedule.pad > constants.SLACK) && (schedule.pad - m > constants.SLACK) )  {
            pushFlex( schedule.pad - m );
            continue;
        }

        let dayTime = t % schedule.period;
        let slot = null;
        let remaining = null;
        let late = null;
        for (let i = 0; i < s.length; i++) {
            let endTime;
            if (i == s.length - 1) {
                endTime = s[0].time + schedule.period;
            } else {
                endTime = s[i+1].time;
            }

            if ((s[i].time <= dayTime) && (dayTime < endTime)) {
                slot = s[i];
                remaining = endTime - dayTime;
                late = dayTime - s[i].time;
                break;
            }
            if ((s[i].time <= dayTime + schedule.period) && (dayTime + schedule.period < endTime)) {
                slot = s[i];
                dayTime += schedule.period;
                remaining = endTime - dayTime;
                late = dayTime + schedule.period - s[i].time;
                break;
            }
        }
        if (slot == null) {
            throw Error("Unexpected. Unable to find slot for time of day " + t + " " + dayTime);
        }
        let item = getNextForSlot(slot, remaining);

        if (late >= schedule.lateness + constants.SLACK ) {
            //it's late.
            item = {
                isOffline : true,
                duration: remaining,
            }
        }

        if (item.isOffline) {
            //flex or redirect. We can just use the whole duration
            item.duration = remaining;
            pushProgram(item);
            continue;
        }
        if (item.duration > remaining) {
            // Slide
            pushProgram(item);
            advanceSlot(slot);
            continue;
        }

        let padded = makePadded(item);
        let total = padded.totalDuration;
        advanceSlot(slot);
        let pads = [ padded ];

        while(true) {
            let item2 = getNextForSlot(slot, remaining);
            if (total + item2.duration > remaining) {
                break;
            }
            let padded2 = makePadded(item2);
            pads.push(padded2);
            advanceSlot(slot);
            total += padded2.totalDuration;
        }
        let rem = Math.max(0, remaining - total);

        if (flexBetween) {
            let div = Math.floor(rem / schedule.pad );
            let mod = rem % schedule.pad;
            // add mod to the latest item
            pads[ pads.length - 1].pad += mod;
            pads[ pads.length - 1].totalDuration += mod;

            let sortedPads = pads.map( (p, $index) => {
                return {
                    pad: p.pad,
                    index : $index,
                }
            });
            sortedPads.sort( (a,b) => { return a.pad - b.pad; } );
            for (let i = 0; i < pads.length; i++) {
                let q = Math.floor( div / pads.length );
                if (i < div % pads.length) {
                    q++;
                }
                let j = sortedPads[i].index;
                pads[j].pad += q * schedule.pad;
            }
        } else {
            //also add div to the latest item
            pads[ pads.length - 1].pad += rem;
            pads[ pads.length - 1].totalDuration += rem;
        }
        // now unroll them all
        for (let i = 0; i < pads.length; i++) {
            pushProgram( pads[i].item );
            pushFlex( pads[i].pad );
        }
    }
    while ( (t > hardLimit) || (p.length >= LIMIT) ) {
        t -= p.pop().duration;
    }
    let m = (t - t0) % schedule.period;
    if (m > 0) {
        //ensure the schedule is a multiple of period
        pushFlex( schedule.period - m);
    }


    return {
        programs: p,
        startTime: (new Date(t0)).toISOString(),
    }

}




