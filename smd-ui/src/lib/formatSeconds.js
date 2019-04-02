export function sec2Date(sec){
    if (sec == 0){
        return "Just Started";
    }
    let seconds = sec;
    const days = Math.floor(seconds / (3600*24));
    seconds  -= days*3600*24;
    const hrs   = Math.floor(seconds / 3600);
    seconds  -= hrs*3600;
    const mnts = Math.floor(seconds / 60);
    seconds  -= mnts*60;
    const div = ":";
    const ret = days + div+ hrs + div + mnts + div + Math.floor(seconds);
    return ret;
}
