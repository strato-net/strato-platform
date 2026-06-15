export const uploadList = [
  {
    "contractAddress": "c918420c68346af5fe2aef067faf7b103afde5ed",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg",
    "createdAt": "2018-06-25T05:37:42.962Z"
  },
  {
    "contractAddress": "c0d225c56af10ad58eb2c16bd8dfaca3273894ef",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529909829846-jellyfish-25-mbps-hd-hevc.3gp",
    "createdAt": "2018-06-25T06:57:32.559Z"
  },
  {
    "contractAddress": "51a867e95aa68efcd2c320352e0861e4f015af88",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529912097617-soap-bubble-1958650_960_720.jpg",
    "createdAt": "2018-06-25T07:35:01.058Z"
  },
  {
    "contractAddress": "9c22ec56dd721cd3ca138dc1d1a05d567e019e36",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529915329415-widescreen.jpeg",
    "createdAt": "2018-06-25T08:28:53.139Z"
  },
  {
    "contractAddress": "edf7fa43718c27d10e6d49bfa8d8942578cc1a87",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529923413618-SampleVideo_360x240_30mb.mkv",
    "createdAt": "2018-06-25T10:43:56.089Z"
  },
  {
    "contractAddress": "9479054a30b89cdd4a512e127049deb042e7e199",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529924931049-widescreen.jpeg",
    "createdAt": "2018-06-25T11:08:54.468Z"
  },
  {
    "contractAddress": "132b62b6b32660aeb707aaed5bfd4cbaed9eb81b",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529925597965-widescreen.jpeg",
    "createdAt": "2018-06-25T11:20:00.638Z"
  },
  {
    "contractAddress": "57ffd407be86add24fb9ff6125708494b7c09a25",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529931868271-1529923413618-SampleVideo_360x240_30mb.mkv",
    "createdAt": "2018-06-25T13:04:55.881Z"
  },
  {
    "contractAddress": "2425395e37a3623de0f1f6e87781cb9e39fba179",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529934246777-jellyfish-25-mbps-hd-hevc.3gp",
    "createdAt": "2018-06-25T13:44:27.411Z"
  },
  {
    "contractAddress": "b928fe10d9d9ece8755b93dfddc32eb1c6db3fe7",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529934327270-soap-bubble-1958650_960_720.jpg",
    "createdAt": "2018-06-25T13:45:30.725Z"
  },
  {
    "contractAddress": "9d5fdf1738593c2f93f098b55a765485a1574d1f",
    "uri": "https://strato-external-storage.s3.amazonaws.com/1529999523270-widescreen.jpeg",
    "createdAt": "2018-06-26T07:52:06.094Z"
  }
];

export const error = 'ERROR';

export const initialState = {
  error: null,
  uploadList: []
}

export const attestDocumentMock = {
  "attested": true,
  "signers": [
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "c78fe66db1ea50566c130c9d74408c597a3df430",
    "c78fe66db1ea50566c130c9d74408c597a3df430",
    "c78fe66db1ea50566c130c9d74408c597a3df430",
    "c78fe66db1ea50566c130c9d74408c597a3df430",
    "a78e6daf479419c9d1dd5a1852877ada081a0f8e"
  ]
}

export const verifyMock = {
  "uri": "https://strato-external-storage.s3.amazonaws.com/1529909829846-jellyfish-25-mbps-hd-hevc.3gp",
  "timeStamp": 1529909843,
  "signers": [
    "23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c",
    "c78fe66db1ea50566c130c9d74408c597a3df430"
  ]
}