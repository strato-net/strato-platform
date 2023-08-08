import dayjs from 'dayjs';

export function getStringDate(time, format) {
  const timestamp = Number(time);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const adjustedTime = time < 1000000000000 ? time * 1000 : time;
  return dayjs(Number(adjustedTime)).format(format);
}

// Remove all non-digit characters from the phone number using regex
export function cleanPhoneNumber(phoneNumber) {
  return phoneNumber.replace(/\D/g, '');
}