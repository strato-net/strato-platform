export function sec2Date(sec){
    let seconds = sec;
    console.log(seconds)
    const days = Math.floor(seconds / (3600*24));
    console.log(days)
    seconds  -= days*3600*24;
    const hrs   = Math.floor(seconds / 3600);
    seconds  -= hrs*3600;
    const mnts = Math.floor(seconds / 60);
    seconds  -= mnts*60;
    const div = ":";
    const ret = days + div+ hrs + div + mnts + div + seconds;
    console.log(ret)
    return ret;
}
