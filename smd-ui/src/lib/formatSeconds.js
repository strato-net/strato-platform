export function sec2Date(sec){
    if (sec === 0){
        return " ";
    }
    let seconds = sec;
    const days = Math.floor(seconds / (3600*24));
    seconds  -= days*3600*24;
    const hrs   = Math.floor(seconds / 3600);
    seconds  -= hrs*3600;
    const mnts = Math.floor(seconds / 60);
    seconds  -= mnts*60;
    const ret = `Uptime ${(days > 0 ? days + "d " : "")} ${hrs}:${mnts}:${Math.floor(seconds)}`
    return ret;
}
