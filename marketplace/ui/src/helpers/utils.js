import dayjs from "dayjs";
import { US_DATE_FORMAT } from "./constants";

export function getStringDate(time, format) {
  const timestamp = Number(time);
  if (Number.isNaN(timestamp)) {
    return "";
  }
  const adjustedTime = time < 1000000000000 ? time * 1000 : time;
  return dayjs(Number(adjustedTime)).format(format);
}

export function arrayToStr(arr) {
  let valueString = "";
  arr.map((value) => (valueString += value + ","));
  valueString = valueString.slice(0, valueString.length - 1);

  return valueString;
}
export function arrayToCsv(data) {
  return data
    .map((row) =>
      row
        .map(String)
        .map((v) => v.replaceAll('"', '""'))
        .map((v) => `"${v}"`)
        .join(",")
    )
    .join("\r\n");
}

export const downloadSample = () => {
  let csv = arrayToCsv([
    ["ItemSerialNumber"],
    ["A123"],
    ["A124"],
    ["A125"],
    ["A126"],
    ["BB46"],
  ]);
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var linkToDownload = document.createElement("a");
  linkToDownload.href = url;
  linkToDownload.setAttribute("download", "sample.csv");
  linkToDownload.click();
};

export function epochToDate(epoch) {
  return dayjs.unix(epoch).format(US_DATE_FORMAT);
}

export function removeSpecialCharacters(str) {
  return str.replace(/[^a-zA-Z0-9 ]/g, '');
}
