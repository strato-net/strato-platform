import * as moment from 'moment';

export function getFormatedDate(time) {
    const utcDate = time.replace(' UTC', 'Z')
    var date = new Date(utcDate);
    const formatedDate = moment(date).format('YYYY-MM-DD hh:mm:ss A')
    return formatedDate
}
