import React from "react";
export function sec2Date(sec){
    if (sec === undefined || sec <= 0 ){
        return <div></div>;
    }
    let seconds = sec;
    const days = Math.floor(seconds / (3600*24));
    const daysString = days.toString().padStart(2, "0");
    seconds  -= days*3600*24;
    const hrs = Math.floor(seconds / 3600);
    const hoursString = hrs.toString().padStart(2, "0");
    seconds  -= hrs*3600;
    const mnts = Math.floor(seconds / 60);
    const minutesString = mnts.toString().padStart(2, "0");
    seconds  -= mnts*60;
    const secondsString = Math.floor(seconds).toString().padStart(2, "0");
    const ret = <div>
        Uptime {days > 0 ? <span>{daysString}d:</span> : null}
         <span>
             {hoursString}:
        </span>
        <span>
             {minutesString}:

        </span>
        <span>
             {secondsString}
        </span>
    </div>
    return ret;
}
