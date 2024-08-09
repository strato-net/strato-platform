export const status = {
  1: "Awaiting Fulfillment",
  2: "Payment Pending",
  3: "Closed",
  4: "Canceled",
  5: "Discarded"
};

export const statusByName = {
  "Awaiting Fulfillment": "Awaiting Fulfillment",
  "Payment Pending": "Payment Pending",
  "Closed": "Closed",
  "Canceled": "Canceled",
};

export const getStatusByName = (name) => {
  return statusByName[`${name}`];
};

export const getStatus = (num) => {
  return status[`${num}`];
};

export const getStatusByValue = (value) => {
  return Object.keys(status).find((key) => status[key] === value);
};

export const TYPE_COLOR = {
    Order:"#2A53FF",
    Transfer:"#FF0000",
    Redemption:"#001C76"
    }

export const TRANSACTION_FILTER = [
    {value:"", label:"All"},
    {value:"Order", label:"Order"},
    {value:"Transfer", label:"Transfer"}, 
    {value:"Redemption", label:"Redemption"}] 

export const dummyData = [ //TODO: Remove this Transaction_Dummy_Data after UI Design
  {
      "id": 375,
      "address": "7120d44d9448b55495ca1dd552dd7e2643a45e9d",
      "block_hash": "a3ed5a6a706e834053e11ec3bdf7a696dffd292305eba1cd3281e62222273c21",
      "block_timestamp": "2024-07-17 14:57:57 UTC",
      "block_number": "41695",
      "transaction_hash": "3ba4a098a06bc240b82e6bc2b6e3fef16b46d28d4eab5cab154700c9975180b7",
      "transaction_sender": "e18ba33ec95a5b2aae5e9b93a161ae882de4e229",
      "orderHash": "ea3a0b8a0d81226a944a9da9a361de725260c412b07c388a894c0a2cc17969a3",
      "reference": "643745",
      "type": "Order",
      "purchaser": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "from": "tanujsoni53",
      "saleAddresses": [
          "9c3c7e9f9c2f0c2289d28ee82c298fa410b97e34"
      ],
      "quantities": [
          1
      ],
      "amount": 12,
      "tax": 0,
      "unitsPerDollar": 1,
      "currency": "USD",
      "status": "3",
      "createdDate": 1721228271,
      "grossMargin": null,
      "comments": "Thank you for your payment.",
      "fee": 1.2,
      "price": 12,
      "quantity":1,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/5822961d2ec079d7df0b784e9459f289bbdb3ea9fb1f57c574f36639a104e8ff.jpg",
      "assetName": "Test 01"
  },
  {
      "id": 369,
      "address": "7120d44d9448b55495ca1dd552dd7e2643a45e9d",
      "block_hash": "95e8ab58137d86441e9acfd26ce2cb10ca6615edd93a6052557816215383ceaa",
      "block_timestamp": "2024-07-17 12:58:48 UTC",
      "block_number": "41667",
      "transaction_hash": "6ed4703a087f6ad2e3247e37f6ae4ecd4b066bab28f915c95fae9402a115621e",
      "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "orderHash": "ee5de511587b134046a20aa63c3a57a19e3794da342854516a9c37e3bf342971",
      "reference": "643660",
      "type": "Transfer",
      "purchaser": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "from": "tanujsoni53",
      "saleAddresses": [
          "7e684f892fb23251d3d09763ebc0f19d8d8e91b0"
      ],
      "quantities": [
          1
      ],
      "amount": 1.32,
      "tax": 0,
      "unitsPerDollar": 1,
      "currency": "",
      "status": "1",
      "createdDate": 1721221141,
      "grossMargin": null,
      "comments": "",
      "fee": 0,
      "price": 1.32,
      "quantity":15,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/74a72e655ddda4874c312b8bd0d4b26159de1d4bcd7e49f7c55e168a3b00d138.jpg",
      "assetName": "Test 02"
  },
  {
      "id": 368,
      "address": "7120d44d9448b55495ca1dd552dd7e2643a45e9d",
      "block_hash": "13333b8f4b6464e808b13c917aafc538b6492ff98b0690e722917f5b1c485c1e",
      "block_timestamp": "2024-07-17 12:53:28 UTC",
      "block_number": "41663",
      "transaction_hash": "57981d7ea73485103163f4bde4366d5f5366cb400feb0b6646d68b3bd2dfda61",
      "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "orderHash": "aabfd0ed74e8043b1c152e378102273a9c2618abeb548b7353838ae3bdd6dfb8",
      "reference": "738073",
      "type": "Redemption",
      "purchaser": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "from": "tanujsoni53",
      "saleAddresses": [
          "8ad7d29a895a1c99d036f660ef2db591d3d390f5"
      ],
      "quantities": [
          12
      ],
      "amount": 1.35,
      "tax": 0,
      "unitsPerDollar": 1,
      "currency": "",
      "status": "1",
      "createdDate": 1721220857,
      "grossMargin": null,
      "comments": "",
      "fee": 0,
      "price": 1.35,
      "quantity":19,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/2e72ee87277cabb44606ec73459e1863b28e31ce817e832c4e678e9f8b8fff35.png",
      "assetName": "Test 03"
      
  },
  {
      "address": "baf20aa9bdef30d91bdac6365642d60c7412b371",
      "block_hash": "bf8ee0a13a125235104f389d67aba56841a3eee404f3c88e9abfc5fb49f9d70f",
      "block_timestamp": "2024-06-27 09:45:11 UTC",
      "block_number": "40263",
      "transaction_hash": "46f177dd3d782e88633277b71c48cebb0e5b4e74c6450d450a0fbfa0db661205",
      "transaction_sender": "c67de732e480618b6dd9b3f5a7e2d5fae9cf2e1c",
      "creator": "tanujsonib40",
      "root": "baf20aa9bdef30d91bdac6365642d60c7412b371",
      "contract_name": "tanujsonib40-SimpleOrder",
      "data": {},
      "createdDate": 1719481550,
      "reference": 212554,
      "type": "Order",
      "purchasersAddress": "c67de732e480618b6dd9b3f5a7e2d5fae9cf2e1c",
      "to": "tanujsonib40",
      "sellerCommonName": null,
      "shippingAddress": null,
      "status": "3",
      "status_fkey": null,
      "price": 520,
      "quantity":21,
      "comments": "Thank you for your payment.",
      "fulfillmentDate": 1719481550,
      "paymentSessionId": "cs_test_a15NcruQPnUejkRK96xKbwDUjlbvEqtx977prrYv29VjJHnoEI34MAOxEB",
      "sellersAddress": null,
      "from": "tanujsoni53",
      "outstandingSales": 0,
      "quantities": [
        15
    ],
      "shippingAddressId": 1,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/d0018b32782b24f52248fa912640046c4cdd63a8204044874c5018670ddb5143.jpg",
      "assetName": "Test 04",
      "BlockApps-Mercata-Order-saleAddresses": [
          {
              "key": "0",
              "root": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "value": "22626706039dcb90a6f2f3539e16f321caf50c3f",
              "address": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "creator": "BlockApps",
              "block_hash": "bf8ee0a13a125235104f389d67aba56841a3eee404f3c88e9abfc5fb49f9d70f",
              "block_number": "40263",
              "contract_name": "Order",
              "collectionname": "saleAddresses",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-27 09:45:11 UTC",
              "transaction_hash": "46f177dd3d782e88633277b71c48cebb0e5b4e74c6450d450a0fbfa0db661205",
              "transaction_sender": "c67de732e480618b6dd9b3f5a7e2d5fae9cf2e1c"
          }
      ],
      "BlockApps-Mercata-Order-quantities": [
          {
              "key": "0",
              "root": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "value": "1",
              "address": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "creator": "BlockApps",
              "block_hash": "bf8ee0a13a125235104f389d67aba56841a3eee404f3c88e9abfc5fb49f9d70f",
              "block_number": "40263",
              "contract_name": "Order",
              "collectionname": "quantities",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-27 09:45:11 UTC",
              "transaction_hash": "46f177dd3d782e88633277b71c48cebb0e5b4e74c6450d450a0fbfa0db661205",
              "transaction_sender": "c67de732e480618b6dd9b3f5a7e2d5fae9cf2e1c"
          }
      ],
      "BlockApps-Mercata-Order-completedSales": [
          {
              "key": "0",
              "root": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "value": "True",
              "address": "baf20aa9bdef30d91bdac6365642d60c7412b371",
              "creator": "BlockApps",
              "block_hash": "bf8ee0a13a125235104f389d67aba56841a3eee404f3c88e9abfc5fb49f9d70f",
              "block_number": "40263",
              "contract_name": "Order",
              "collectionname": "completedSales",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-27 09:45:11 UTC",
              "transaction_hash": "46f177dd3d782e88633277b71c48cebb0e5b4e74c6450d450a0fbfa0db661205",
              "transaction_sender": "c67de732e480618b6dd9b3f5a7e2d5fae9cf2e1c"
          }
      ]
  },
  {
      "address": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
      "block_hash": "a092911c2fe5613b3f0af577f968115177fb99f6d106b72de679ec08290197fb",
      "block_timestamp": "2024-06-19 13:39:04 UTC",
      "block_number": "40085",
      "transaction_hash": "24a06d397f9b9627624fbaa03f44da5b2d1e55154f24aed2e957c5404566a31f",
      "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "creator": "tanujsoni54",
      "root": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
      "contract_name": "tanujsoni54-SimpleOrder",
      "data": {},
      "createdDate": 1718804371,
      "reference": 230231,
      "type": "Transfer",
      "purchasersAddress": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "sellerCommonName": null,
      "shippingAddress": null,
      "status": "3",
      "status_fkey": null,
      "price": 81,
      "quantity":9,
      "comments": "Thank you for your payment.",
      "fulfillmentDate": 1718804371,
      "paymentSessionId": "cs_test_a1Pv0qDFVoEsEeftRKxBf5tcnxLmmjN8qefXUpqieSRkzls7WrLz0mf3zl",
      "sellersAddress": null,
      "from": "tanujsoni53",
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/d0018b32782b24f52248fa912640046c4cdd63a8204044874c5018670ddb5143.jpg",
      "assetName": "Test 05",
      "outstandingSales": 0,
      "shippingAddressId": 1,
      "BlockApps-Mercata-Order-saleAddresses": [
          {
              "key": "0",
              "root": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "value": "c1ef46664cb1a3359d42d4f51baa1ead43a0051b",
              "address": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "creator": "BlockApps",
              "block_hash": "a092911c2fe5613b3f0af577f968115177fb99f6d106b72de679ec08290197fb",
              "block_number": "40085",
              "contract_name": "Order",
              "collectionname": "saleAddresses",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 13:39:04 UTC",
              "transaction_hash": "24a06d397f9b9627624fbaa03f44da5b2d1e55154f24aed2e957c5404566a31f",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-quantities": [
          {
              "key": "0",
              "root": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "value": "1",
              "address": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "creator": "BlockApps",
              "block_hash": "a092911c2fe5613b3f0af577f968115177fb99f6d106b72de679ec08290197fb",
              "block_number": "40085",
              "contract_name": "Order",
              "collectionname": "quantities",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 13:39:04 UTC",
              "transaction_hash": "24a06d397f9b9627624fbaa03f44da5b2d1e55154f24aed2e957c5404566a31f",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-completedSales": [
          {
              "key": "0",
              "root": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "value": "True",
              "address": "96ba742e4168cf36b97abeb5c5af8424d950c4fc",
              "creator": "BlockApps",
              "block_hash": "a092911c2fe5613b3f0af577f968115177fb99f6d106b72de679ec08290197fb",
              "block_number": "40085",
              "contract_name": "Order",
              "collectionname": "completedSales",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 13:39:04 UTC",
              "transaction_hash": "24a06d397f9b9627624fbaa03f44da5b2d1e55154f24aed2e957c5404566a31f",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ]
  },
  {
      "address": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
      "block_hash": "945d1dca9715e8e8376e91e7cfe9d3a42509aebc5e830a7b67a89bc40fa263fd",
      "block_timestamp": "2024-06-19 12:24:18 UTC",
      "block_number": "40075",
      "transaction_hash": "0e0a17621d990269180a206c4743bf0316154c35bd7d1e6c05f6b884dc646a25",
      "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "creator": "tanujsoni54",
      "root": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
      "contract_name": "tanujsoni54-SimpleOrder",
      "data": {},
      "createdDate": 1718799915,
      "reference": 617304,
      "type": "Redemption",
      "purchasersAddress": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "sellerCommonName": null,
      "shippingAddress": null,
      "status": "3",
      "status_fkey": null,
      "price": 101,
      "quantity":7,
      "comments": "Thank you for your payment.",
      "fulfillmentDate": 1718799915,
      "paymentSessionId": "cs_test_a1w6iFP1KonChcEgPwapf3lbVJkc20Z9Q80n6sM3D2q6T7nNyOQvQlf501",
      "sellersAddress": null,
      "from": "tanujsoni53",
      "outstandingSales": 0,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/ff2be69c463d995f1a0dcf9dd4c37efe9e48e782021b0a68cbf471d298d32366.png",
      "assetName": "Test 06",
      "shippingAddressId": 1,
      "BlockApps-Mercata-Order-saleAddresses": [
          {
              "key": "0",
              "root": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "value": "a8e46b9e24d055ed4728178be8ca24ea291c2627",
              "address": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "creator": "BlockApps",
              "block_hash": "945d1dca9715e8e8376e91e7cfe9d3a42509aebc5e830a7b67a89bc40fa263fd",
              "block_number": "40075",
              "contract_name": "Order",
              "collectionname": "saleAddresses",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 12:24:18 UTC",
              "transaction_hash": "0e0a17621d990269180a206c4743bf0316154c35bd7d1e6c05f6b884dc646a25",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-quantities": [
          {
              "key": "0",
              "root": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "value": "1",
              "address": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "creator": "BlockApps",
              "block_hash": "945d1dca9715e8e8376e91e7cfe9d3a42509aebc5e830a7b67a89bc40fa263fd",
              "block_number": "40075",
              "contract_name": "Order",
              "collectionname": "quantities",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 12:24:18 UTC",
              "transaction_hash": "0e0a17621d990269180a206c4743bf0316154c35bd7d1e6c05f6b884dc646a25",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-completedSales": [
          {
              "key": "0",
              "root": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "value": "True",
              "address": "c021cbc5833beef34cf749799f667f2c2d6a6c84",
              "creator": "BlockApps",
              "block_hash": "945d1dca9715e8e8376e91e7cfe9d3a42509aebc5e830a7b67a89bc40fa263fd",
              "block_number": "40075",
              "contract_name": "Order",
              "collectionname": "completedSales",
              "collectiontype": "Array",
              "block_timestamp": "2024-06-19 12:24:18 UTC",
              "transaction_hash": "0e0a17621d990269180a206c4743bf0316154c35bd7d1e6c05f6b884dc646a25",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ]
  },
  {
      "address": "ca7d5791aa655d82fdde3490a767554d98c082b0",
      "block_hash": "30913c1ccfa3e4f78529121bb69c555c70610b575c1b601e4f38876cb6aa2957",
      "block_timestamp": "2024-05-14 17:59:38 UTC",
      "block_number": "37676",
      "transaction_hash": "b7a017b7e477436c7125eb6937abf09cf951ae062e67a022b5754e43a7be1f31",
      "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "creator": "tanujsoni54",
      "root": "ca7d5791aa655d82fdde3490a767554d98c082b0",
      "contract_name": "tanujsoni54-SimpleOrder",
      "data": {},
      "createdDate": 1715709609,
      "reference": 938284,
      "type": "Order",
      "purchasersAddress": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d",
      "to": "tanujsoni54",
      "sellerCommonName": null,
      "shippingAddress": null,
      "status": "3",
      "status_fkey": null,
      "price": 81,
      "quantity":4,
      "comments": "Thank you for your payment.",
      "fulfillmentDate": 1715709609,
      "paymentSessionId": "cs_test_a1bnKhvsnjNadjyeUqiQv2xgYfCQfmTJMDAWzcu3aLwNJWcSVocF3RBA0D",
      "sellersAddress": null,
      "from": "tanujsoni53",
      "outstandingSales": 0,
      "shippingAddressId": 1,
      "assetImage": "https://fileserver.mercata-testnet2.blockapps.net/highway/ff2be69c463d995f1a0dcf9dd4c37efe9e48e782021b0a68cbf471d298d32366.png",
      "assetName": "Test 07",
      "BlockApps-Mercata-Order-saleAddresses": [
          {
              "key": "0",
              "root": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "value": "7733683b2792b757417a2e39fbff995d202b8662",
              "address": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "creator": "BlockApps",
              "block_hash": "30913c1ccfa3e4f78529121bb69c555c70610b575c1b601e4f38876cb6aa2957",
              "block_number": "37676",
              "contract_name": "Order",
              "collectionname": "saleAddresses",
              "collectiontype": "Array",
              "block_timestamp": "2024-05-14 17:59:38 UTC",
              "transaction_hash": "b7a017b7e477436c7125eb6937abf09cf951ae062e67a022b5754e43a7be1f31",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-quantities": [
          {
              "key": "0",
              "root": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "value": "1",
              "address": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "creator": "BlockApps",
              "block_hash": "30913c1ccfa3e4f78529121bb69c555c70610b575c1b601e4f38876cb6aa2957",
              "block_number": "37676",
              "contract_name": "Order",
              "collectionname": "quantities",
              "collectiontype": "Array",
              "block_timestamp": "2024-05-14 17:59:38 UTC",
              "transaction_hash": "b7a017b7e477436c7125eb6937abf09cf951ae062e67a022b5754e43a7be1f31",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ],
      "BlockApps-Mercata-Order-completedSales": [
          {
              "key": "0",
              "root": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "value": "True",
              "address": "ca7d5791aa655d82fdde3490a767554d98c082b0",
              "creator": "BlockApps",
              "block_hash": "30913c1ccfa3e4f78529121bb69c555c70610b575c1b601e4f38876cb6aa2957",
              "block_number": "37676",
              "contract_name": "Order",
              "collectionname": "completedSales",
              "collectiontype": "Array",
              "block_timestamp": "2024-05-14 17:59:38 UTC",
              "transaction_hash": "b7a017b7e477436c7125eb6937abf09cf951ae062e67a022b5754e43a7be1f31",
              "transaction_sender": "fe550a7b71ae3a32b03c9b287f84eb451e76bd3d"
          }
      ]
  }
]