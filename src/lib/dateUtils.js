import moment from 'moment'

export function parseDateFromString(timeAsString) {
    const utcDate = timeAsString.replace(' UTC', 'Z')
    var date = new Date(utcDate);
    const formatedDate = moment(date).format('YYYY-MM-DD hh:mm:ss A')
    return formatedDate
}
