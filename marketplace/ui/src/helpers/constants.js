import { AMEX, Discover, Mastercard, VISA, BANK } from "../images/SVGComponents";

export const apiUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + "/api/v1"
  : "/api/v1";

  
export const fileServerUrl = window.REACT_APP_FILE_SERVER_URL && window.REACT_APP_FILE_SERVER_URL !== '__REACT_APP_FILE_SERVER_URL__' ? window.REACT_APP_FILE_SERVER_URL 
                              : (process.env.REACT_APP_FILE_SERVER_URL ? process.env.REACT_APP_FILE_SERVER_URL : '');

// export const fileServerUrl = process.env.REACT_APP_FILE_SERVER_URL;
console.log('window.REACT_APP_FILE_SERVER_URL', window.REACT_APP_FILE_SERVER_URL)
console.log('ProcessENVVar REACT_APP_FILE_SERVER_URL', process.env.REACT_APP_FILE_SERVER_URL)

console.log('fileServerUrl', fileServerUrl)

export const cirrusUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + "/cirrus/search"
  : "/cirrus/search"

export const HTTP_METHODS = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
  PUT: "PUT",
};

export const UNIT_OF_MEASUREMENTS = {
  1: "LB",
  2: "Ounce",
  3: "Ton",
  4: "Bag",
  5: "Box",
  6: "Piece",
  7: "Bale",
  8: "Gallon",
  9: "Pound",
  10: "Yard",
  11: "Kilogram"
};

export const US_DATE_FORMAT = "MM/DD/YYYY";

export const MAX_QUANTITY = 1000000;
export const MAX_PRICE = 100000000;

export const INVENTORY_STATUS = {
  PUBLISHED: 1,
  UNPUBLISHED: 2,
  "1": "Published",
  "2": "Unpublished",
};

export const getUnitNameByIndex = (index) => {
  const unit = unitOfMeasures.find((measure) => measure.value === parseInt(index));

  if (unit) {
    if (unit.name.length > 20) {
      // Extract abbreviation from inside brackets
      const matches = unit.name.match(/\((.*?)\)/);
      if (matches && matches.length > 1) {
        return matches[1];
      }
    }
    
    return unit.name;
  }
  
  return null;
};

export const unitOfMeasures = [
  { name: "Gram (G)", value: 1 },
  { name: "Kilogram (KG)", value: 2 },
  { name: "Troy Ounce (t oz)", value: 3 },
  { name: "Troy Pound (t lb)", value: 4 },
  { name: "Avoirdupois Ounce (AVDP Oz)", value: 5 },
  { name: "Avoirdupois Pound (AVDP Lb)", value: 6 },
  { name: "Metric Ton (TON)", value: 7 },
  { name: "Imperial Ton (TONNE)", value: 8 }
];

export const CHARGES = {
  "SHIPPING": 0,
  "TAX": 0
}
export const MAX_RAW_MATERIAL = 8;


export const STATUS_FILTER = [
  {
    text: "Pending",
    value: "Pending",
  },
  {
    text: "Approved",
    value: "Approved",
  },
  {
    text: "Rejected",
    value: "Rejected",
  },
];

export const STATUS = {
  0: "",
  1: "Pending",
  2: "Approved",
  3: "Rejected",
  "Pending": 1,
  "Approved": 2,
  "Rejected": 3
};

export const APPROVAL_STATUS = {
  1: "Accept",
  2: "Reject",
  "Accept": 1,
  "Reject": 2,
};

export const CATEGORIES = [
  "Art",
  "CarbonOffset",
  "Metals",
  "Clothing",
  "Membership",
  "CarbonDAO",
  "Collectibles"
]

export const PAYMENT_TYPE = [
  { 
    name: "Credit Card / ACH", 
    value: 1, 
    options: [
      <AMEX width="30px" height="20px"/>,
      <Discover width="30px" height="20px"/>,
      <Mastercard width="30px" height="20px"/>,
      <VISA width="30px" height="20px"/>,
      <BANK width="30px" height="20px"/>
    ]
  }
]

export const ORDER_STATUS = {
  "AWAITING_FULFILLMENT": 1,
  "AWAITING_SHIPMENT": 2,
  "CLOSED": 3,
  "CANCELED": 4,
  "PAYMENT_PENDING": 5
}

export const PAYMENT_LIST = ['card','us_bank_account']