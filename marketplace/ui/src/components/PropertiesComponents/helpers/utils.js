import React from 'react';
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

// decode uri component and replace %0A with new line4
// export const decodeURIComponentText = (encodedURI) => decodeURIComponent(encodedURI.replace(/%0A/g, '\n'));

export const decodeURIComponentText = (encodedText, readmore) => {
  const decodedText = decodeURIComponent(encodedText.replace(/%0A/g, '\n'));

  if (readmore) {
    return decodedText.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}
        <br />
      </React.Fragment>
    ));
  } else {
    return decodedText.slice(0, 100).split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}
        <br />
      </React.Fragment>
    ));
  }
};


//convert unix timestamp to human readable date
export function unixToDate(unixTimestamp) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const date = new Date(unixTimestamp * 1000); // Convert to milliseconds
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  const daySuffix = getDaySuffix(day);

  return `${month} ${day}${daySuffix}, ${year}`;
}

function getDaySuffix(day) {
  if (day >= 11 && day <= 13) {
    return "th";
  }

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}