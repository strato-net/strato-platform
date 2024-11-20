import dayjs from 'dayjs';
import { US_DATE_FORMAT } from './constants';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

export function getStringDate(time, format) {
  const timestamp = Number(time);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const adjustedTime = time < 1000000000000 ? time * 1000 : time;
  return dayjs(Number(adjustedTime)).format(format);
}

export function getAgoTime(time, format) {
  const timestamp = Number(time);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const adjustedTime = time < 1000000000000 ? time * 1000 : time;
  return dayjs(Number(adjustedTime)).fromNow();
}

export function arrayToStr(arr) {
  let valueString = '';
  arr.map((value) => (valueString += value + ','));
  valueString = valueString.slice(0, valueString.length - 1);

  return valueString;
}

export function groupBy(array, keyAccessor) {
  return array.reduce((accumulator, element) => {
    const key = keyAccessor(element);

    if (!accumulator[key]) {
      accumulator[key] = [];
    }

    accumulator[key].push(element);

    return accumulator;
  }, {});
}

export function arrayToCsv(data) {
  return data
    .map((row) =>
      row
        .map(String)
        .map((v) => v.replaceAll('"', '""'))
        .map((v) => `"${v}"`)
        .join(',')
    )
    .join('\r\n');
}

export const downloadSample = () => {
  let csv = arrayToCsv([
    ['ItemSerialNumber'],
    ['A123'],
    ['A124'],
    ['A125'],
    ['A126'],
    ['BB46'],
  ]);
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var linkToDownload = document.createElement('a');
  linkToDownload.href = url;
  linkToDownload.setAttribute('download', 'sample.csv');
  linkToDownload.click();
};

export function epochToDate(epoch) {
  return dayjs.unix(epoch).format(US_DATE_FORMAT);
}

export const handlePriceInput = (setpricePerUnit) => (event) => {
  let value = event.target.value;
  value = value.replace(/[^0-9.]/g, ''); // remove any non-numeric characters

  const parts = value.split('.');
  if (parts.length > 2) {
    value = parts[0] + '.' + parts.slice(1).join('');
  } else if (parts.length === 2 && parts[1].length > 2) {
    parts[1] = parts[1].substring(0, 2);
    value = parts.join('.');
  }
  event.target.value = value;
  if (value) {
    setpricePerUnit(parseFloat(value));
  } else {
    setpricePerUnit(0);
  }
};

export const handleQuantityInput = (setQuantity) => (event) => {
  let value = event.target.value;
  value = value.replace(/[^0-9]/g, ''); // remove any non-numeric characters and decimal points
  event.target.value = value;
  if (value) {
    setQuantity(value);
  } else {
    setQuantity(0);
  }
};

export const handleWalletAddressInput = (setUserAddress) => (event) => {
  let value = event.target.value;
  value = value.replace(/[^a-zA-Z0-9]/g, ''); // remove any characters that are not alphanumeric
  event.target.value = value;
  setUserAddress(value);
};
