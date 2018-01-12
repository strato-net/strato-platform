import moment from 'moment';

export function parseDateFromString(timeAsString) {
  const utcDate = timeAsString.replace(' UTC', 'Z')
  const formattedDate = moment(utcDate).format('YYYY-MM-DD hh:mm:ss A')
  return formattedDate
}
