// context/TokenContext.tsx
import { TokenData } from "@/interface/token";
import axios from "axios";
import React, { createContext, useContext, useEffect, useState } from "react";

interface Token {
  id: string;
  name: string;
  symbol: string;
  // add more fields based on your API response
}

interface TokenContextType {
  tokens: Token[] | null;
  loading: boolean;
}

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: React.ReactNode }) => {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTokens = async () => {
        axios.get('http://localhost:3001/api/tokens/')
        .then(res => {
          console.log(res, 'res');
          const formattedData = res.data.map((d: any) => {
            const name = d._name || '';
            return {
              name,
              symbol: name.slice(0, 2).toUpperCase(), // Get first 2 letters as symbol
              address: d.address || ''
            };
          });
          console.log(formattedData, 'formattedData');
          setTokens(formattedData);
        })
        .catch(err => console.log(err))
    };

    fetchTokens();
  }, []);

  return (
    <TokenContext.Provider value={{ tokens, loading }}>
      {children}
    </TokenContext.Provider>
  );
};

export const useTokens = () => {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error("useTokens must be used within a TokenProvider");
  }
  return context;
};

// // Temprory hardcoding tokens till api works
// export const popularTokens = [
//   { symbol: "ETH", name: "Ethereum", address: "0x..." },
//   { symbol: "USDC", name: "USD Coin", address: "0xA0b8...eB48" },
//   { symbol: "USDT", name: "Tether", address: "0xdAC1...1ec7" },
//   {
//     symbol: "WBTC",
//     name: "Wrapped Bitcoin",
//     address: "0x2260...C599",
//   },
//   { symbol: "WETH", name: "Wrapped Ether", address: "0x..." },
// ];

export const popularTokens: any[]  = [
  {
      "address": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
      "block_hash": "0f892181d72e9ecf179cf90b397750454042a762e510bb9045e675e3f816b355",
      "block_timestamp": "2025-03-19 15:56:57 UTC",
      "block_number": "92665",
      "transaction_hash": "e57e54866fb8b94d746d480a05a2c71e8a9c73e7292cac2e9264433832a10ff7",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
      "contract_name": "david nallapu-DavidGoldMetal",
      "data": {
          "name": "SILVST2",
          "owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
          "purity": "good",
          "source": "earth",
          "decimals": "18",
          "quantity": "0",
          "itemNumber": "0",
          "createdDate": "1213",
          "description": "SILVST",
          "originAddress": "NULL",
          "ownerCommonName": "david nallapu",
          "redemptionService": "00000000000000000000000000000000deadbeef",
          "unitOfMeasurement": "3",
          "leastSellableUnits": "1"
      },
      "_name": "SILVST2",
      "_symbol": "",
      "_totalSupply": 10000000000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
              "value": "9999999757",
              "address": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
              "creator": "BlockApps",
              "block_hash": "0f892181d72e9ecf179cf90b397750454042a762e510bb9045e675e3f816b355",
              "block_number": "92665",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-19 15:56:57 UTC",
              "transaction_hash": "e57e54866fb8b94d746d480a05a2c71e8a9c73e7292cac2e9264433832a10ff7",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          },
          {
              "key": "775c6146bde542e6b8a5897cf67d033a6e983ec1",
              "root": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
              "value": "243",
              "address": "4a5cf225d09e44c2c13fddce82673f41e69047bc",
              "creator": "BlockApps",
              "block_hash": "0f892181d72e9ecf179cf90b397750454042a762e510bb9045e675e3f816b355",
              "block_number": "92665",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-19 15:56:57 UTC",
              "transaction_hash": "e57e54866fb8b94d746d480a05a2c71e8a9c73e7292cac2e9264433832a10ff7",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "4bb823714473ee3dd549eef752f13c50ea3be970",
      "block_hash": "d47023d75acffb620a6116d71e457eb6bfbeeaa967e0ddcbc2ad6cc43c8b0e25",
      "block_timestamp": "2025-03-19 15:51:31 UTC",
      "block_number": "92660",
      "transaction_hash": "5815a9e1980c49a4a956196328a6724aec1b4d0d386dd2a185b9c7c902ed3c98",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "4bb823714473ee3dd549eef752f13c50ea3be970",
      "contract_name": "david nallapu-DavidGoldMetal",
      "data": {
          "name": "SILVST",
          "owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
          "purity": "good",
          "source": "earth",
          "decimals": "18",
          "quantity": "0",
          "itemNumber": "0",
          "createdDate": "1213",
          "description": "SILVST",
          "originAddress": "NULL",
          "ownerCommonName": "david nallapu",
          "redemptionService": "00000000000000000000000000000000deadbeef",
          "unitOfMeasurement": "3",
          "leastSellableUnits": "1"
      },
      "_name": "SILVST",
      "_symbol": "",
      "_totalSupply": 10000000000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "4bb823714473ee3dd549eef752f13c50ea3be970",
              "value": "10000000000",
              "address": "4bb823714473ee3dd549eef752f13c50ea3be970",
              "creator": "BlockApps",
              "block_hash": "d47023d75acffb620a6116d71e457eb6bfbeeaa967e0ddcbc2ad6cc43c8b0e25",
              "block_number": "92660",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-19 15:51:31 UTC",
              "transaction_hash": "5815a9e1980c49a4a956196328a6724aec1b4d0d386dd2a185b9c7c902ed3c98",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "0d9bbae3a4e595c69fdc14367367753619df9f19",
      "block_hash": "150a82c6144195020bf2cb76cd4a0ec66edb4814bd64093333fddf913d5bf62e",
      "block_timestamp": "2025-03-24 15:09:56 UTC",
      "block_number": "92788",
      "transaction_hash": "d05291f183f47f7ae1028cfe08423637571a53a2dc5e2463ddebcc13e87b28c4",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "0d9bbae3a4e595c69fdc14367367753619df9f19",
      "contract_name": "david nallapu-SIMPLEERC20",
      "data": {
          "_owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
      },
      "_name": "David",
      "_symbol": "DSN",
      "_totalSupply": 1100,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "0d9bbae3a4e595c69fdc14367367753619df9f19",
              "value": "1100",
              "address": "0d9bbae3a4e595c69fdc14367367753619df9f19",
              "creator": "BlockApps",
              "block_hash": "150a82c6144195020bf2cb76cd4a0ec66edb4814bd64093333fddf913d5bf62e",
              "block_number": "92788",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 15:09:56 UTC",
              "transaction_hash": "d05291f183f47f7ae1028cfe08423637571a53a2dc5e2463ddebcc13e87b28c4",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "02210020b52b3e05895b4fea46a12042868f8aae",
      "block_hash": "6c66973f1dba73eb7d7a47d193ddbe9cccaf070627f024bb4be2316c21a9e939",
      "block_timestamp": "2025-03-26 19:57:18 UTC",
      "block_number": "93247",
      "transaction_hash": "2333d69a44eafc385ea474eca1717628b69e6d8a10a0c318a8da6830a4270cbd",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "02210020b52b3e05895b4fea46a12042868f8aae",
      "contract_name": "mercata_usdst-SimplePool6",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 340000000000000000000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "02210020b52b3e05895b4fea46a12042868f8aae",
              "value": "340000000000000000000",
              "address": "02210020b52b3e05895b4fea46a12042868f8aae",
              "creator": "BlockApps",
              "block_hash": "6c66973f1dba73eb7d7a47d193ddbe9cccaf070627f024bb4be2316c21a9e939",
              "block_number": "93247",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 19:57:18 UTC",
              "transaction_hash": "2333d69a44eafc385ea474eca1717628b69e6d8a10a0c318a8da6830a4270cbd",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
      "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
      "block_timestamp": "2025-03-24 17:27:50 UTC",
      "block_number": "92831",
      "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "mktest",
      "root": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
      "contract_name": "mktest-SimpleERC20",
      "data": {
          "owner": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
      },
      "_name": "USDC",
      "_symbol": "USDC",
      "_totalSupply": 10000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
              "value": "10000",
              "address": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
              "creator": "BlockApps",
              "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
              "block_number": "92831",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 17:27:50 UTC",
              "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
              "root": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
              "value": "0",
              "address": "11c45f841ee168ffaf6f583c88417a1f4f71b455",
              "creator": "BlockApps",
              "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
              "block_number": "92831",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 17:27:50 UTC",
              "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "2c0029e38f4661b1241316431416fae2885d0e53",
      "block_hash": "c0dacc70f239d48964db9b2d73e72e676adad5c24704c260db4c3dedae1b4500",
      "block_timestamp": "2025-03-19 15:47:25 UTC",
      "block_number": "92658",
      "transaction_hash": "9ac58d6b813e4639b68481c22217b480878c58494a9bb84f0bec292a134e0282",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "2c0029e38f4661b1241316431416fae2885d0e53",
      "contract_name": "david nallapu-DavidGoldMetal",
      "data": {
          "name": "SILVST",
          "owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
          "purity": "good",
          "source": "earth",
          "decimals": "18",
          "quantity": "0",
          "itemNumber": "0",
          "createdDate": "1213",
          "description": "SILVST",
          "originAddress": "NULL",
          "ownerCommonName": "david nallapu",
          "redemptionService": "00000000000000000000000000000000deadbeef",
          "unitOfMeasurement": "3",
          "leastSellableUnits": "1"
      },
      "_name": "SILVST",
      "_symbol": "",
      "_totalSupply": 10000000000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "2c0029e38f4661b1241316431416fae2885d0e53",
              "value": "10000000000",
              "address": "2c0029e38f4661b1241316431416fae2885d0e53",
              "creator": "BlockApps",
              "block_hash": "c0dacc70f239d48964db9b2d73e72e676adad5c24704c260db4c3dedae1b4500",
              "block_number": "92658",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-19 15:47:25 UTC",
              "transaction_hash": "9ac58d6b813e4639b68481c22217b480878c58494a9bb84f0bec292a134e0282",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "25ab94fe8618e203117cf95799ec6a89a0b94b99",
      "block_hash": "18e0f30084eb6b84d0444b30c9ba8ef7e11f356e512b6c0cc279c4755949e5e5",
      "block_timestamp": "2025-03-26 14:09:12 UTC",
      "block_number": "93222",
      "transaction_hash": "ce7ea91b7002605b578e13240ebfb77348071643cb2023d77e5053c17dfc5a87",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "25ab94fe8618e203117cf95799ec6a89a0b94b99",
      "contract_name": "mercata_usdst-SimplePool4",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "46589dcd8c74e77cd26fc0f5ef913d71ffed9a67",
      "block_hash": "d1b8a5290b62a6da9333eb3e0c62077a07c6ce74e1cd59d75d2bb39733ca1d29",
      "block_timestamp": "2025-03-24 14:54:04 UTC",
      "block_number": "92778",
      "transaction_hash": "73dd9d8c98a83b3c351a2763e7fb7b49612ae1a813bfe59342975be10d2e2396",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "mktest",
      "root": "46589dcd8c74e77cd26fc0f5ef913d71ffed9a67",
      "contract_name": "mktest-SImpleERC20",
      "data": {},
      "_name": "David",
      "_symbol": "\\\"D",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "29b858db22495de353c203df17b682f48f93884e",
      "block_hash": "480861677eff474c8b76c818c648e81833c6e2ae241c5c8e8e627e98608bdeac",
      "block_timestamp": "2025-03-26 13:42:18 UTC",
      "block_number": "93186",
      "transaction_hash": "9448c2624fca4eb391ad276bea3c125859f6f37abafb3a2393647238c0e5fb4e",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "29b858db22495de353c203df17b682f48f93884e",
      "contract_name": "mercata_usdst-SimplePool2",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
      "block_hash": "849ce919faf377a79c36b87a0f4d9754f3b2338a9158e2b8cc687fdb3e60976d",
      "block_timestamp": "2025-03-28 13:46:29 UTC",
      "block_number": "93459",
      "transaction_hash": "a0693a0a77a9511d60d19d349c467c9d93aac0c8d6996ea2e028625878d44f7f",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
      "contract_name": "mercata_usdst-SimplePool11",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
              "value": "34000000000000000000000000",
              "address": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
              "creator": "BlockApps",
              "block_hash": "7aaa24f354deaece573f83223dc8e940bee72f7491e4a176834653b5267a8f5b",
              "block_number": "93457",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:46:04 UTC",
              "transaction_hash": "75e69033ef9d1c576a011883ac51058e2972cac4faef0c020a8ebde9fdd06cb2",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
      "block_hash": "fa1a888414d11125dd49260c83dcd9691f3a6da5408aba85be319f75ae955c43",
      "block_timestamp": "2025-03-26 13:59:42 UTC",
      "block_number": "93210",
      "transaction_hash": "8208ff699fadd810167e8485c67f6cff93e04619a0da107cbb422726f723bec6",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
      "contract_name": "mercata_usdst-SimplePool3",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.363e+23,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
              "value": "336300000000000000000000",
              "address": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
              "creator": "BlockApps",
              "block_hash": "a459afb3faf3d1be0a41cc6bc4e1799058b0e160366d30bab3f3c383c048d7f4",
              "block_number": "93200",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:49:40 UTC",
              "transaction_hash": "d7f5260432e9d2ae095cd70dc1547dcccd60cb0e8179e07a8cb88484f92c269c",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
      "block_hash": "c2459b068f32427388c999cb8680b3a705fce9cd9cecc16a82321418ad87318d",
      "block_timestamp": "2025-04-24 21:49:55 UTC",
      "block_number": "95101",
      "transaction_hash": "12572eb6ba7770dab3dfae879e90d95a1fa4a2263c0ec483dadd129d455764a2",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
      "contract_name": "mercata_usdst-ERC20Simple2",
      "data": {
          "owner": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
      },
      "_name": "SILVST",
      "_symbol": "SILVST",
      "_totalSupply": 1.0000000001e+30,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "0d6fb79c076a1cb6f5631d7d54943c9e4e101dcd",
              "root": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "value": "1000000000000979999000000",
              "address": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "creator": "BlockApps",
              "block_hash": "711e4040762dcf5dc4a9f07d3a906607ef73eecb648099d24b01b1e6b86bf593",
              "block_number": "94210",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-07 19:00:49 UTC",
              "transaction_hash": "3c6b9548850d255fcf8da9079b843b979c4a5ec2fc1032335f2b2663914041b7",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "value": "999930000099029409784707911763",
              "address": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "creator": "BlockApps",
              "block_hash": "38ed385df0cbfc3a10fdf3195eb02a72f43ccbb658f8456142e63717feeb058f",
              "block_number": "94521",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-14 16:58:02 UTC",
              "transaction_hash": "fd8e4c16ed767d0472b174b400856f81232a7e4bcca7a32c30e9a2eba49268d1",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a4f64d8e685a246418bc528e8854d4db67280c4b",
              "root": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "value": "999999970589235293088237",
              "address": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "creator": "BlockApps",
              "block_hash": "05bc944e94dbc27d7874511881d05dcee2e1fbaf0efcd24f1cf2d6a9889768ab",
              "block_number": "93579",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-31 13:41:30 UTC",
              "transaction_hash": "eae7fef62172e470653f884b9c02fcd8bb74dc135f97ea5117c8b181d7170430",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "83afa8ade9a1c91e915f42b0c503d7b92f61ff86",
              "root": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "value": "68000001000000000000000000",
              "address": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
              "creator": "BlockApps",
              "block_hash": "91cee422198dbd0228b6d3d90ac1e6a34138b95c06433aab5bc259758f3577ba",
              "block_number": "93762",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-02 20:22:54 UTC",
              "transaction_hash": "77335877a98db4257b9084c4f85338ce58f4c20198fe7fbf853f6aec8e94ec46",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
      "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
      "block_timestamp": "2025-03-28 13:57:51 UTC",
      "block_number": "93479",
      "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
      "contract_name": "mercata_usdst-SimplePool13",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
              "value": "34000000000000000000000000",
              "address": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
              "creator": "BlockApps",
              "block_hash": "34ddbb722a5ea2ffbde843feb96c0964fee932d96c9424e729d38ee7e8c8b5f7",
              "block_number": "93470",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:53:30 UTC",
              "transaction_hash": "511eb837505cb2916c6aca34feaa026954b83d1d80c3b6dbf7204b5e2ec08aba",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "3f6d81183dec8a641578f8297739699b44777962",
      "block_hash": "e07254f590e8509c02d5c91787f2b1e4aa1216ddb4a887c126c9330c25e83b7b",
      "block_timestamp": "2025-03-28 13:32:00 UTC",
      "block_number": "93441",
      "transaction_hash": "1e791654437d3160e5384764adb6c0729ac30560b578104ec8e33cff78050a0b",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "3f6d81183dec8a641578f8297739699b44777962",
      "contract_name": "mercata_usdst-SILV_USDST_Pool2",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+22,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "3f6d81183dec8a641578f8297739699b44777962",
              "value": "34000000000000000000000",
              "address": "3f6d81183dec8a641578f8297739699b44777962",
              "creator": "BlockApps",
              "block_hash": "2121b78cb8235463af816ee9e97011784c1e11ca1770f171b53637ceb3457d59",
              "block_number": "93340",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:22:06 UTC",
              "transaction_hash": "ccd7e062e1dac6b524625993661b58b17165d4d5b7d8227b492f2cd55950be85",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "4936e14e601d39a4bcc00a122119724152daaea4",
      "block_hash": "7582610010384be03ff4919d2bc3f6ecc577df1da27bcb263ffe1055a6a02b7b",
      "block_timestamp": "2025-03-28 13:43:41 UTC",
      "block_number": "93452",
      "transaction_hash": "ea302dfebbe247e6109f58563f4222b10c022cbd349dd720e895a2acdae4cca7",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "4936e14e601d39a4bcc00a122119724152daaea4",
      "contract_name": "mercata_usdst-SimplePool10",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "4936e14e601d39a4bcc00a122119724152daaea4",
              "value": "34000000000000000000000000",
              "address": "4936e14e601d39a4bcc00a122119724152daaea4",
              "creator": "BlockApps",
              "block_hash": "34fa7b2dff21aa641b1333fb9b6644bd157ade58a624e55b5d038bbaa06d6795",
              "block_number": "93450",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:42:44 UTC",
              "transaction_hash": "687d96d544d8f785c6a58b5403d65e345469e8753b257dc4cf7bafd6e9a49d4b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "6a294181aa156a4604de1f963ad2d60884702af2",
      "block_hash": "106fcc982b454594124bb28f6b44bfc573cd4d06aaf2f2224ad23c1e637bd97b",
      "block_timestamp": "2025-04-10 14:34:17 UTC",
      "block_number": "94340",
      "transaction_hash": "2207737bf7c54dce9b35da2ecb05cc7ef5f6a34163bbef48aad72b6730d58ce9",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "6a294181aa156a4604de1f963ad2d60884702af2",
      "contract_name": "david nallapu-ERC20Simple",
      "data": {
          "owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
      },
      "_name": "Simple",
      "_symbol": "S",
      "_totalSupply": 10000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "775c6146bde542e6b8a5897cf67d033a6e983ec1",
              "root": "6a294181aa156a4604de1f963ad2d60884702af2",
              "value": "50",
              "address": "6a294181aa156a4604de1f963ad2d60884702af2",
              "creator": "BlockApps",
              "block_hash": "9bb877a17861b10682f8e9a70af3994d771e071d0067a69c402a58539fe4bc0a",
              "block_number": "93004",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-25 13:17:25 UTC",
              "transaction_hash": "792b3b162c9e020845e732c185ee6e369cb40a035d5ac1b9e4c124392deb428d",
              "transaction_sender": "7f4df636c884be90ed18c1077644359ffcd32c21"
          },
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "6a294181aa156a4604de1f963ad2d60884702af2",
              "value": "9810",
              "address": "6a294181aa156a4604de1f963ad2d60884702af2",
              "creator": "BlockApps",
              "block_hash": "106fcc982b454594124bb28f6b44bfc573cd4d06aaf2f2224ad23c1e637bd97b",
              "block_number": "94340",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-10 14:34:17 UTC",
              "transaction_hash": "2207737bf7c54dce9b35da2ecb05cc7ef5f6a34163bbef48aad72b6730d58ce9",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          },
          {
              "key": "7f4df636c884be90ed18c1077644359ffcd32c21",
              "root": "6a294181aa156a4604de1f963ad2d60884702af2",
              "value": "40",
              "address": "6a294181aa156a4604de1f963ad2d60884702af2",
              "creator": "BlockApps",
              "block_hash": "de1c12b8c2ea1a338d6dcce26fbbc6c917c0a150577e42f3e2a56ed87ca86a48",
              "block_number": "93049",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-25 14:27:43 UTC",
              "transaction_hash": "0fb188410dcece73f80ea2e38953e5ef895bf98b8d934aab59932e250d8b857b",
              "transaction_sender": "7f4df636c884be90ed18c1077644359ffcd32c21"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "6a294181aa156a4604de1f963ad2d60884702af2",
              "value": "100",
              "address": "6a294181aa156a4604de1f963ad2d60884702af2",
              "creator": "BlockApps",
              "block_hash": "fc46b4105d160c1656b6fdb5bcb05e66d245b3bb0764244a766346d0696ed5ff",
              "block_number": "93046",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-25 14:26:07 UTC",
              "transaction_hash": "04c5b1f6af228a9b7838611e7dcf7efc3a942e32db452e8eedd81a3aea906e9b",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
      "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
      "block_timestamp": "2025-03-28 13:57:51 UTC",
      "block_number": "93479",
      "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
      "contract_name": "mercata_usdst-ERC20Simple",
      "data": {
          "owner": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
      },
      "_name": "ERC20USDST",
      "_symbol": "EUSDST",
      "_totalSupply": 3.401001e+27,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "3264236640999999965999876886",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
              "block_number": "93479",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:57:51 UTC",
              "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "46992999999999999999999",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "284a67ba0faa4a9ad308d13dbe9d4eeed9d65c7973481c8163dd05651a1228b6",
              "block_number": "93201",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:49:53 UTC",
              "transaction_hash": "de7735b2bf0169d95bce732ee70a4d5462d84cc015cb8609200ef90cbce60638",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "3363000000000000000001",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "5505cddd91239bd83daedee2d2c0dd3d42497a80cc279659bf130a4272ecb8f2",
              "block_number": "93183",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:39:28 UTC",
              "transaction_hash": "37198e10bec07297696f150acf7ceb9cf6934dace3e2fa052f88a495a3967504",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          },
          {
              "key": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "336300000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "a459afb3faf3d1be0a41cc6bc4e1799058b0e160366d30bab3f3c383c048d7f4",
              "block_number": "93200",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:49:40 UTC",
              "transaction_hash": "d7f5260432e9d2ae095cd70dc1547dcccd60cb0e8179e07a8cb88484f92c269c",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "02210020b52b3e05895b4fea46a12042868f8aae",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "340000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "6c66973f1dba73eb7d7a47d193ddbe9cccaf070627f024bb4be2316c21a9e939",
              "block_number": "93247",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 19:57:18 UTC",
              "transaction_hash": "2333d69a44eafc385ea474eca1717628b69e6d8a10a0c318a8da6830a4270cbd",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "71158e28d64a0426de53a4278f0b4534657a9b76",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "3363000000000000000050",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "b0b041d6814e09764be61edb2664d97a1c761ea886598fbec9c8f14e1394014b",
              "block_number": "93306",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:43:11 UTC",
              "transaction_hash": "809bd080af78451a762042d9785e9fa10689414d20ffdd4334a0fcc13024678b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "33999999730",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "160a28811df5b35498658da476a4530f2d143ec2bbedc2ddc725a759da6f9ca4",
              "block_number": "93319",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:56:19 UTC",
              "transaction_hash": "65348691d11ebbc9481741c311e537f8e23b9ad865fe596e96a36851747310ee",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "340000000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "4f986ad2f80066dd6c5ae9727727d5149594150cf98b5ca6e51174c7ce4c6625",
              "block_number": "93327",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:08:46 UTC",
              "transaction_hash": "a4c4ff64be8966d4d24a1250f6ff5c742e1d8fcee6e9b75ae23df5f9dfc0906f",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "3f6d81183dec8a641578f8297739699b44777962",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "34000000000000000000034",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "1eb906c9a5ad3088bc77846f91dfa34bab0253571c8e6550dfd6acf7e77435a0",
              "block_number": "93344",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:23:30 UTC",
              "transaction_hash": "340b7f7d58467f1001db32784aa71a468711de7a5665decdc66ae75c39ab9008",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "4936e14e601d39a4bcc00a122119724152daaea4",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "34000000000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "34fa7b2dff21aa641b1333fb9b6644bd157ade58a624e55b5d038bbaa06d6795",
              "block_number": "93450",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:42:44 UTC",
              "transaction_hash": "687d96d544d8f785c6a58b5403d65e345469e8753b257dc4cf7bafd6e9a49d4b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "34000000000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "7aaa24f354deaece573f83223dc8e940bee72f7491e4a176834653b5267a8f5b",
              "block_number": "93457",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:46:04 UTC",
              "transaction_hash": "75e69033ef9d1c576a011883ac51058e2972cac4faef0c020a8ebde9fdd06cb2",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a792699bd5549017a412bbe2d5d4b0593165337e",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "34000000000000000000000000",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "2fb60099f7744c37493a2b823cecd9d21c5ee89bcc31ff579eef985703bef030",
              "block_number": "93464",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:51:11 UTC",
              "transaction_hash": "2b1808adeee27803ae62ed7af8181793b0e863f7f552f849f22e167dcfe64610",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
              "root": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "value": "34000000000000000000123300",
              "address": "4e1c58b48ae7e178e25494be103071a74d4116d0",
              "creator": "BlockApps",
              "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
              "block_number": "93479",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:57:51 UTC",
              "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "5b129abd490842d73207f758220d4259402659e2",
      "block_hash": "c1f13e39e02ff7323bc942f9fbf3c00e2fa3502c58ba19a7c90cd502325b5a67",
      "block_timestamp": "2025-03-26 14:10:45 UTC",
      "block_number": "93224",
      "transaction_hash": "af492d647657777585535c97e04f836c806004913151ae3cf67d944ac1014b8c",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "5b129abd490842d73207f758220d4259402659e2",
      "contract_name": "mercata_usdst-SimplePool5",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "83afa8ade9a1c91e915f42b0c503d7b92f61ff86",
      "block_hash": "91cee422198dbd0228b6d3d90ac1e6a34138b95c06433aab5bc259758f3577ba",
      "block_timestamp": "2025-04-02 20:22:54 UTC",
      "block_number": "93762",
      "transaction_hash": "77335877a98db4257b9084c4f85338ce58f4c20198fe7fbf853f6aec8e94ec46",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "83afa8ade9a1c91e915f42b0c503d7b92f61ff86",
      "contract_name": "mercata_usdst-PhysicalRedemptionService",
      "data": {
          "pool": "389677d271b4ff5dbf06e1853b33fdfd0ba3135a",
          "owner": "NULL",
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "usdst": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
          "_owner": "NULL",
          "imageURL": "test",
          "isActive": "True",
          "spotPrice": "34",
          "redeemText": "test",
          "serviceURL": "test",
          "serviceName": "test",
          "getRedemptionRoute": "test",
          "maxRedemptionAmount": "3400000000000000000000000000",
          "closeRedemptionRoute": "test",
          "createRedemptionRoute": "test",
          "getCustomerAddressRoute": "test",
          "incomingRedemptionsRoute": "test",
          "outgoingRedemptionsRoute": "test",
          "createCustomerAddressRoute": "test"
      },
      "_name": "",
      "_symbol": "",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
      "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
      "block_timestamp": "2025-03-28 13:57:51 UTC",
      "block_number": "93479",
      "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
      "contract_name": "mercata_usdst-ERC20Simple",
      "data": {
          "owner": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
      },
      "_name": "ERC20SILVST",
      "_symbol": "ESILVST",
      "_totalSupply": 2.00101e+26,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "195098878999999999000003613",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
              "block_number": "93479",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:57:51 UTC",
              "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000011000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "392cca4d26038aecc5cb44bd22467ca81728bb13614268b23b80dadbca69cc57",
              "block_number": "93202",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:50:50 UTC",
              "transaction_hash": "4aab2962a55ae0e53183f168e18e1e2773ac8b5c9a1ac88cf6b65bc4b65779e7",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "16b560e841b85dd3103b171a11b61f44edc8fdd1",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "a459afb3faf3d1be0a41cc6bc4e1799058b0e160366d30bab3f3c383c048d7f4",
              "block_number": "93200",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:49:40 UTC",
              "transaction_hash": "d7f5260432e9d2ae095cd70dc1547dcccd60cb0e8179e07a8cb88484f92c269c",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000009",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "160a28811df5b35498658da476a4530f2d143ec2bbedc2ddc725a759da6f9ca4",
              "block_number": "93319",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:56:19 UTC",
              "transaction_hash": "65348691d11ebbc9481741c311e537f8e23b9ad865fe596e96a36851747310ee",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "71158e28d64a0426de53a4278f0b4534657a9b76",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "10000000000000000001",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "b0b041d6814e09764be61edb2664d97a1c761ea886598fbec9c8f14e1394014b",
              "block_number": "93306",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:43:11 UTC",
              "transaction_hash": "809bd080af78451a762042d9785e9fa10689414d20ffdd4334a0fcc13024678b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "99000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "5505cddd91239bd83daedee2d2c0dd3d42497a80cc279659bf130a4272ecb8f2",
              "block_number": "93183",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:39:28 UTC",
              "transaction_hash": "37198e10bec07297696f150acf7ceb9cf6934dace3e2fa052f88a495a3967504",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          },
          {
              "key": "02210020b52b3e05895b4fea46a12042868f8aae",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "6c66973f1dba73eb7d7a47d193ddbe9cccaf070627f024bb4be2316c21a9e939",
              "block_number": "93247",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 19:57:18 UTC",
              "transaction_hash": "2333d69a44eafc385ea474eca1717628b69e6d8a10a0c318a8da6830a4270cbd",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "4f986ad2f80066dd6c5ae9727727d5149594150cf98b5ca6e51174c7ce4c6625",
              "block_number": "93327",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:08:46 UTC",
              "transaction_hash": "a4c4ff64be8966d4d24a1250f6ff5c742e1d8fcee6e9b75ae23df5f9dfc0906f",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "3f6d81183dec8a641578f8297739699b44777962",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "1eb906c9a5ad3088bc77846f91dfa34bab0253571c8e6550dfd6acf7e77435a0",
              "block_number": "93344",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:23:30 UTC",
              "transaction_hash": "340b7f7d58467f1001db32784aa71a468711de7a5665decdc66ae75c39ab9008",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "4936e14e601d39a4bcc00a122119724152daaea4",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "34fa7b2dff21aa641b1333fb9b6644bd157ade58a624e55b5d038bbaa06d6795",
              "block_number": "93450",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:42:44 UTC",
              "transaction_hash": "687d96d544d8f785c6a58b5403d65e345469e8753b257dc4cf7bafd6e9a49d4b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "13e1513e0514a9c20dd09c44ca10b045b659b0ad",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "7aaa24f354deaece573f83223dc8e940bee72f7491e4a176834653b5267a8f5b",
              "block_number": "93457",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:46:04 UTC",
              "transaction_hash": "75e69033ef9d1c576a011883ac51058e2972cac4faef0c020a8ebde9fdd06cb2",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a792699bd5549017a412bbe2d5d4b0593165337e",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "1000000000000000000000000",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "2fb60099f7744c37493a2b823cecd9d21c5ee89bcc31ff579eef985703bef030",
              "block_number": "93464",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:51:11 UTC",
              "transaction_hash": "2b1808adeee27803ae62ed7af8181793b0e863f7f552f849f22e167dcfe64610",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "2cc36329b8e7b58db3d1cb6886ec20b5a2edafb2",
              "root": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "value": "999999999999999999996376",
              "address": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
              "creator": "BlockApps",
              "block_hash": "4066402d0146a5768efe22170dc152d62f63d80ad60c0ee86473572e52497a36",
              "block_number": "93479",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:57:51 UTC",
              "transaction_hash": "ac2007cd32764190f6254bc104701a378d5e03e65e2f22da6eeb46d21bdc4d67",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "8a6985f4eb68e90c86e902b8934970432ae51c64",
      "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
      "block_timestamp": "2025-03-24 17:27:50 UTC",
      "block_number": "92831",
      "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "david nallapu",
      "root": "8a6985f4eb68e90c86e902b8934970432ae51c64",
      "contract_name": "david nallapu-SimpleERC20",
      "data": {
          "owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
      },
      "_name": "DavidERC20",
      "_symbol": "D",
      "_totalSupply": 10000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "value": "66",
              "address": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "creator": "BlockApps",
              "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
              "block_number": "92831",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 17:27:50 UTC",
              "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "value": "9934",
              "address": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "creator": "BlockApps",
              "block_hash": "1800442c645905e22566ee6b29790a9b465ab19bdb0cbdb672a41adfdf647511",
              "block_number": "92801",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 15:19:36 UTC",
              "transaction_hash": "47ddc1bfc5b457d28a089dfc87730e09b0efa3488d01e294aa09008d23a8d318",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
              "root": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "value": "0",
              "address": "8a6985f4eb68e90c86e902b8934970432ae51c64",
              "creator": "BlockApps",
              "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
              "block_number": "92831",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 17:27:50 UTC",
              "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "8e687afdd9b05f3fece3c60d9850ddc72759ea8e",
      "block_hash": "5611daecfbabe46c01a7b1277929bc1cf79d759db9f65c43234cef8fa2c466d5",
      "block_timestamp": "2025-03-24 15:03:38 UTC",
      "block_number": "92783",
      "transaction_hash": "73df1724aa6ba6dfbf1b601498f0613f1acb199d542d46c71d91e8705a61d11f",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "david nallapu",
      "root": "8e687afdd9b05f3fece3c60d9850ddc72759ea8e",
      "contract_name": "david nallapu-SIMpleERC20",
      "data": {
          "_owner": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
      },
      "_name": "DSN",
      "_symbol": "DSN",
      "_totalSupply": 1000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
              "root": "8e687afdd9b05f3fece3c60d9850ddc72759ea8e",
              "value": "1000",
              "address": "8e687afdd9b05f3fece3c60d9850ddc72759ea8e",
              "creator": "BlockApps",
              "block_hash": "5611daecfbabe46c01a7b1277929bc1cf79d759db9f65c43234cef8fa2c466d5",
              "block_number": "92783",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 15:03:38 UTC",
              "transaction_hash": "73df1724aa6ba6dfbf1b601498f0613f1acb199d542d46c71d91e8705a61d11f",
              "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64"
          }
      ]
  },
  {
      "address": "e83666f135876739e1016f477c0aae9123150029",
      "block_hash": "159a08a1be3c573ff962e2a7299f7c81b2a518b5900011d63fb7ec414b38bf17",
      "block_timestamp": "2025-03-24 15:03:27 UTC",
      "block_number": "92782",
      "transaction_hash": "85d607bc66b6969992274ed04649379ecea19330cf68e36c3ce2eec5229d3cbf",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "mktest",
      "root": "e83666f135876739e1016f477c0aae9123150029",
      "contract_name": "mktest-SIMpleERC20",
      "data": {
          "_owner": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
      },
      "_name": "David",
      "_symbol": "D",
      "_totalSupply": 1000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "e83666f135876739e1016f477c0aae9123150029",
              "value": "1000",
              "address": "e83666f135876739e1016f477c0aae9123150029",
              "creator": "BlockApps",
              "block_hash": "39b06f90da35648be109316d35338a1bf70568e4311ce124af8cb267cbc6e882",
              "block_number": "92780",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 14:57:47 UTC",
              "transaction_hash": "dfe44ae0e4b107e6b333a07d8db8fed18678577f99366c4e7e2a263cb1fc4fff",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
      "block_hash": "160a28811df5b35498658da476a4530f2d143ec2bbedc2ddc725a759da6f9ca4",
      "block_timestamp": "2025-03-27 16:56:19 UTC",
      "block_number": "93319",
      "transaction_hash": "65348691d11ebbc9481741c311e537f8e23b9ad865fe596e96a36851747310ee",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
      "contract_name": "mercata_usdst-SimplePool8",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 34000000000,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
              "value": "34000000000",
              "address": "9e5031e35b70bcbd0a1ed736470ce8a5a1005737",
              "creator": "BlockApps",
              "block_hash": "9f0ee6cac1bc885685a2e50a4e2a242f36f1e7a3740311f14cc68cb819d53b5f",
              "block_number": "93316",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:53:25 UTC",
              "transaction_hash": "9fb9a6596379e54fdba4171f8279fb247d9bf249fec47842ce443021bc0c6ba9",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
      "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
      "block_timestamp": "2025-03-24 17:27:50 UTC",
      "block_number": "92831",
      "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "mktest",
      "root": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
      "contract_name": "mktest-SimplePool",
      "data": {
          "token": "8a6985f4eb68e90c86e902b8934970432ae51c64",
          "stablecoin": "11c45f841ee168ffaf6f583c88417a1f4f71b455"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
              "value": "0",
              "address": "e9e4a64a4c6c74e6ba39c0e48ed0a54d9543514d",
              "creator": "BlockApps",
              "block_hash": "d8de91359a661b1a0f50359e7f3a68f5fcaca40fdcc2f03a29528c15871f8e65",
              "block_number": "92831",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-24 17:27:50 UTC",
              "transaction_hash": "dba6c8067f4acdea780a731a0a01372e7f327a78cd0ace9eb27f49813bec0f58",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "71158e28d64a0426de53a4278f0b4534657a9b76",
      "block_hash": "263c23857b612b02496cc90d6c5669391b4d9d443f64b6e13a389fe11da4ae9b",
      "block_timestamp": "2025-03-27 17:05:27 UTC",
      "block_number": "93322",
      "transaction_hash": "816feec2a63db3e439beefc91a2eaa605c4f4f0b33ff50e47886d47ff3f9db63",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "71158e28d64a0426de53a4278f0b4534657a9b76",
      "contract_name": "mercata_usdst-SimplePool7",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.363e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "71158e28d64a0426de53a4278f0b4534657a9b76",
              "value": "3363000000000000000050",
              "address": "71158e28d64a0426de53a4278f0b4534657a9b76",
              "creator": "BlockApps",
              "block_hash": "b0b041d6814e09764be61edb2664d97a1c761ea886598fbec9c8f14e1394014b",
              "block_number": "93306",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 16:43:11 UTC",
              "transaction_hash": "809bd080af78451a762042d9785e9fa10689414d20ffdd4334a0fcc13024678b",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "7b257a9861a95eb2a77bc796f7f6f228b7566d56",
      "block_hash": "3f3ed06d667afe5047f6a2d7d5b9963e1088d67a8cbd9683758fbee90febb6a0",
      "block_timestamp": "2025-04-02 17:19:25 UTC",
      "block_number": "93736",
      "transaction_hash": "48757f957d1568929b2b07f445678709e400ecad246c2437c694b17ef952985f",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "7b257a9861a95eb2a77bc796f7f6f228b7566d56",
      "contract_name": "mercata_usdst-PhysicalRedemptionService",
      "data": {
          "pool": "389677d271b4ff5dbf06e1853b33fdfd0ba3135a",
          "owner": "NULL",
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "usdst": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
          "_owner": "NULL",
          "imageURL": "test",
          "isActive": "True",
          "spotPrice": "34",
          "redeemText": "test",
          "serviceURL": "test",
          "serviceName": "test",
          "getRedemptionRoute": "test",
          "maxRedemptionAmount": "1000000000000",
          "closeRedemptionRoute": "test",
          "createRedemptionRoute": "test",
          "getCustomerAddressRoute": "test",
          "incomingRedemptionsRoute": "test",
          "outgoingRedemptionsRoute": "test",
          "createCustomerAddressRoute": "test"
      },
      "_name": "",
      "_symbol": "",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "851d7b1d17f8d9b898526e8dc97c19d8f93af25b",
      "block_hash": "c0bfce287fc3ba56291b3ef9d433452e60f526a0f3e0660fa959753f75ca0058",
      "block_timestamp": "2025-03-26 14:06:42 UTC",
      "block_number": "93217",
      "transaction_hash": "936fc7a1e8e84ad77cb746738503f2cb1796e306af80153f8776b3f5fa2b7eac",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "851d7b1d17f8d9b898526e8dc97c19d8f93af25b",
      "contract_name": "mercata_usdst-SimplePool",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "a4f64d8e685a246418bc528e8854d4db67280c4b",
      "block_hash": "05bc944e94dbc27d7874511881d05dcee2e1fbaf0efcd24f1cf2d6a9889768ab",
      "block_timestamp": "2025-03-31 13:41:30 UTC",
      "block_number": "93579",
      "transaction_hash": "eae7fef62172e470653f884b9c02fcd8bb74dc135f97ea5117c8b181d7170430",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "a4f64d8e685a246418bc528e8854d4db67280c4b",
      "contract_name": "mercata_usdst-MercataPool",
      "data": {
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "locked": "False",
          "stablecoin": "8fba5de6eee3f216668b729179f0a244dc2ec48b"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.3999999e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "a4f64d8e685a246418bc528e8854d4db67280c4b",
              "value": "33999999000000000000000000",
              "address": "a4f64d8e685a246418bc528e8854d4db67280c4b",
              "creator": "BlockApps",
              "block_hash": "05bc944e94dbc27d7874511881d05dcee2e1fbaf0efcd24f1cf2d6a9889768ab",
              "block_number": "93579",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-31 13:41:30 UTC",
              "transaction_hash": "eae7fef62172e470653f884b9c02fcd8bb74dc135f97ea5117c8b181d7170430",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
      "block_hash": "c2459b068f32427388c999cb8680b3a705fce9cd9cecc16a82321418ad87318d",
      "block_timestamp": "2025-04-24 21:49:55 UTC",
      "block_number": "95101",
      "transaction_hash": "12572eb6ba7770dab3dfae879e90d95a1fa4a2263c0ec483dadd129d455764a2",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
      "contract_name": "mercata_usdst-ERC20Simple2",
      "data": {
          "owner": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
      },
      "_name": "USDST",
      "_symbol": "USDST",
      "_totalSupply": 3.4e+31,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "value": "33999897000001000068679930999999",
              "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "creator": "BlockApps",
              "block_hash": "307bb30e043d0b3b5339ce93afc4436c816286ddd7b0b34c19ab6dc48ae59024",
              "block_number": "95089",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-22 22:42:47 UTC",
              "transaction_hash": "c354123e38fd3938cc57ccb11faea72c015039d4ac0ba60c4f11c3269012f07c",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a4f64d8e685a246418bc528e8854d4db67280c4b",
              "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "value": "33999998999966000034999999",
              "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "creator": "BlockApps",
              "block_hash": "05bc944e94dbc27d7874511881d05dcee2e1fbaf0efcd24f1cf2d6a9889768ab",
              "block_number": "93579",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-31 13:41:30 UTC",
              "transaction_hash": "eae7fef62172e470653f884b9c02fcd8bb74dc135f97ea5117c8b181d7170430",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "83afa8ade9a1c91e915f42b0c503d7b92f61ff86",
              "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "value": "33999999999999999999999966",
              "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "creator": "BlockApps",
              "block_hash": "91cee422198dbd0228b6d3d90ac1e6a34138b95c06433aab5bc259758f3577ba",
              "block_number": "93762",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-02 20:22:54 UTC",
              "transaction_hash": "77335877a98db4257b9084c4f85338ce58f4c20198fe7fbf853f6aec8e94ec46",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "0d6fb79c076a1cb6f5631d7d54943c9e4e101dcd",
              "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "value": "33999999999965320034000036",
              "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "creator": "BlockApps",
              "block_hash": "711e4040762dcf5dc4a9f07d3a906607ef73eecb648099d24b01b1e6b86bf593",
              "block_number": "94210",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-07 19:00:49 UTC",
              "transaction_hash": "3c6b9548850d255fcf8da9079b843b979c4a5ec2fc1032335f2b2663914041b7",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          },
          {
              "key": "a5f74f4fc9700a258631865612bb385d28ed0ee6",
              "root": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "value": "1000000000000000000000000",
              "address": "8fba5de6eee3f216668b729179f0a244dc2ec48b",
              "creator": "BlockApps",
              "block_hash": "307bb30e043d0b3b5339ce93afc4436c816286ddd7b0b34c19ab6dc48ae59024",
              "block_number": "95089",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-22 22:42:47 UTC",
              "transaction_hash": "c354123e38fd3938cc57ccb11faea72c015039d4ac0ba60c4f11c3269012f07c",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "1004cea81e2baf39d355e425d7ade9ce037ce084",
      "block_hash": "3f84a8b55a890b661e210448a22a5a06b6f447179351fcfee779cf6cb562bd14",
      "block_timestamp": "2025-04-15 23:47:09 UTC",
      "block_number": "94590",
      "transaction_hash": "a86441ba6904b2e52ca3c01e11c9e085dd0a5a3f59a42e58025ec6a54a202990",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "1004cea81e2baf39d355e425d7ade9ce037ce084",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Collateral Token 22",
      "_symbol": "MKCT22",
      "_totalSupply": 6e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "1004cea81e2baf39d355e425d7ade9ce037ce084",
              "value": "6000000000000000000000",
              "address": "1004cea81e2baf39d355e425d7ade9ce037ce084",
              "creator": "BlockApps",
              "block_hash": "3f84a8b55a890b661e210448a22a5a06b6f447179351fcfee779cf6cb562bd14",
              "block_number": "94590",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-15 23:47:09 UTC",
              "transaction_hash": "a86441ba6904b2e52ca3c01e11c9e085dd0a5a3f59a42e58025ec6a54a202990",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "389677d271b4ff5dbf06e1853b33fdfd0ba3135a",
      "block_hash": "16ca99359e5b33945aba2fb238db0e0b2755c798e21699aaee86dd249fa84396",
      "block_timestamp": "2025-04-04 15:54:41 UTC",
      "block_number": "94077",
      "transaction_hash": "3d55219494cf2e76d627a0ec3525d7723d36bfa9cb9c5a21ca0ed4bff70b65c0",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "eac435a98c03e279c67ad0fb4610c5f8df4c25c8",
      "contract_name": "mercata_usdst-SimplePoolFactory2-Pool",
      "data": {
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "locked": "False",
          "stablecoin": "8fba5de6eee3f216668b729179f0a244dc2ec48b"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
      "block_hash": "d1ef04a229673be6e1950dd26a31c102e7ad7c712a4b4c8764ed04e9b79097f8",
      "block_timestamp": "2025-03-27 17:09:56 UTC",
      "block_number": "93331",
      "transaction_hash": "6df1316272c6767c127536b04ed81375641b248e529adc1b8eada560e7d8d39c",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
      "contract_name": "mercata_usdst-SILV_USDST_Pool",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+23,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
              "value": "340000000000000000000000",
              "address": "d5bca3d731b2c02786d54a15d50fdf120d2d4a2a",
              "creator": "BlockApps",
              "block_hash": "4f986ad2f80066dd6c5ae9727727d5149594150cf98b5ca6e51174c7ce4c6625",
              "block_number": "93327",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-27 17:08:46 UTC",
              "transaction_hash": "a4c4ff64be8966d4d24a1250f6ff5c742e1d8fcee6e9b75ae23df5f9dfc0906f",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "b773039fc0d76a774195a54ed24460c439da2c26",
      "block_hash": "746f6f48070b18da4ea1db8b7b5bdfb509f340c4b7a6572e1091f269b5d488c8",
      "block_timestamp": "2025-04-01 18:13:52 UTC",
      "block_number": "93622",
      "transaction_hash": "a25d6ca38e1981939bc3b4cec1a862b9c64334cbcb7e0c99607c90c44dadc749",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "c27fca90f5e8f7101d403b5fdb15f74ae23b87ea",
      "contract_name": "mercata_usdst-SimplePoolFactory3-SimplePool",
      "data": {
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "locked": "False",
          "stablecoin": "8fba5de6eee3f216668b729179f0a244dc2ec48b"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "0f5c3ae894d6986b164f24b2bdafb3340832d83a",
      "block_hash": "e21993a8b6d31a628ae9d7e3e676727758f1dad617131f50710c3f40249e7222",
      "block_timestamp": "2025-04-14 17:08:34 UTC",
      "block_number": "94525",
      "transaction_hash": "0ccf5a4c8a1cf204ae97f4a15163811ce568f05779bdc5d2b936adab96504f47",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "0f5c3ae894d6986b164f24b2bdafb3340832d83a",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "owner": "NULL",
          "_owner": "NULL",
          "decimals": "0",
          "metadata": "NULL",
          "ownerCommonName": ""
      },
      "_name": "",
      "_symbol": "",
      "_totalSupply": 0,
      "BlockApps-Mercata-ERC20-_balances": []
  },
  {
      "address": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
      "block_hash": "85e121409e3b94d8a6544f0a8ea55594d4307647ceae2b2ee04a02b073146c6d",
      "block_timestamp": "2025-03-26 13:39:35 UTC",
      "block_number": "93184",
      "transaction_hash": "848aabfad04f179fd6b3e3a229377e2a6faf3bc010532c3daec16652d50d0b9e",
      "transaction_sender": "dbbd16df8a2e87429ae345c38dadb4b1b3331a64",
      "creator": "mercata_usdst",
      "root": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
      "contract_name": "mercata_usdst-SimplePool",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "oracle": "6de6426903246b78016c1985fd60c1c6b7589114",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.363e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
              "value": "3363000000000000000000",
              "address": "a6415f7bf128d4a9a41932381e597246d2a3ad1d",
              "creator": "BlockApps",
              "block_hash": "93cdad2f08839d69a9f5b69e8b6b795d0f155de56fb7911f1c33b95e898b55c0",
              "block_number": "93165",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-26 13:32:02 UTC",
              "transaction_hash": "9ccd43020bc73e6ff2c396dad86b0e3182c5a940671f86b5fea5e85544709de0",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "a792699bd5549017a412bbe2d5d4b0593165337e",
      "block_hash": "2fb60099f7744c37493a2b823cecd9d21c5ee89bcc31ff579eef985703bef030",
      "block_timestamp": "2025-03-28 13:51:11 UTC",
      "block_number": "93464",
      "transaction_hash": "2b1808adeee27803ae62ed7af8181793b0e863f7f552f849f22e167dcfe64610",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "a792699bd5549017a412bbe2d5d4b0593165337e",
      "contract_name": "mercata_usdst-SimplePool12",
      "data": {
          "token": "5bd9cd0f322320501d1ec5bd6383b74db0c7bd36",
          "locked": "False",
          "stablecoin": "4e1c58b48ae7e178e25494be103071a74d4116d0"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.4e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "a792699bd5549017a412bbe2d5d4b0593165337e",
              "value": "34000000000000000000000000",
              "address": "a792699bd5549017a412bbe2d5d4b0593165337e",
              "creator": "BlockApps",
              "block_hash": "2fb60099f7744c37493a2b823cecd9d21c5ee89bcc31ff579eef985703bef030",
              "block_number": "93464",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-03-28 13:51:11 UTC",
              "transaction_hash": "2b1808adeee27803ae62ed7af8181793b0e863f7f552f849f22e167dcfe64610",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  },
  {
      "address": "57ab3bebafa8f8ac0f80f02b80001a1deaa401b6",
      "block_hash": "960390cf84a259a94e3c904061377ed971e5a1e5067402f910e0fbfbfea43bd1",
      "block_timestamp": "2025-04-14 20:45:17 UTC",
      "block_number": "94532",
      "transaction_hash": "09a753ef285a99a3ccf39e00763114f508fd2b534c6d2dbfcd847aac04fe51ce",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "57ab3bebafa8f8ac0f80f02b80001a1deaa401b6",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Liquidity Token 1",
      "_symbol": "MKLQ1",
      "_totalSupply": 1e+24,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "57ab3bebafa8f8ac0f80f02b80001a1deaa401b6",
              "value": "1000000000000000000000000",
              "address": "57ab3bebafa8f8ac0f80f02b80001a1deaa401b6",
              "creator": "BlockApps",
              "block_hash": "960390cf84a259a94e3c904061377ed971e5a1e5067402f910e0fbfbfea43bd1",
              "block_number": "94532",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-14 20:45:17 UTC",
              "transaction_hash": "09a753ef285a99a3ccf39e00763114f508fd2b534c6d2dbfcd847aac04fe51ce",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "e420ff2240abaf9211608fd59e2313421aa7ca8f",
      "block_hash": "d00204bb5f417b6aafdc8ad14f5831f0d9cd916617996a8a52aedb2824035fdf",
      "block_timestamp": "2025-04-15 17:15:41 UTC",
      "block_number": "94565",
      "transaction_hash": "38e0a0dbcbc281ec389fb27698b4d53abfe59857ad009e5f042416835500abf6",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "e420ff2240abaf9211608fd59e2313421aa7ca8f",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Collateral Token 1",
      "_symbol": "MKCT1",
      "_totalSupply": 5e+23,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "e420ff2240abaf9211608fd59e2313421aa7ca8f",
              "value": "500000000000000000000000",
              "address": "e420ff2240abaf9211608fd59e2313421aa7ca8f",
              "creator": "BlockApps",
              "block_hash": "d00204bb5f417b6aafdc8ad14f5831f0d9cd916617996a8a52aedb2824035fdf",
              "block_number": "94565",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-15 17:15:41 UTC",
              "transaction_hash": "38e0a0dbcbc281ec389fb27698b4d53abfe59857ad009e5f042416835500abf6",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "e1400bdbafd0ed40239f697dd3a280386ed8a59f",
      "block_hash": "79abc399e3ad8b8e79bbd0521dad7dfaadba5ff363824e50524afe05c0c0c9cf",
      "block_timestamp": "2025-04-15 18:14:27 UTC",
      "block_number": "94568",
      "transaction_hash": "3a0e50fcc9dafd9bcc963ff5183537b5cc4a5c02e55f61811bd557466df8b6e4",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "e1400bdbafd0ed40239f697dd3a280386ed8a59f",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Liquidity Token 2",
      "_symbol": "MKLQ2",
      "_totalSupply": 6e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "e1400bdbafd0ed40239f697dd3a280386ed8a59f",
              "value": "60000000000000000000000000",
              "address": "e1400bdbafd0ed40239f697dd3a280386ed8a59f",
              "creator": "BlockApps",
              "block_hash": "79abc399e3ad8b8e79bbd0521dad7dfaadba5ff363824e50524afe05c0c0c9cf",
              "block_number": "94568",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-15 18:14:27 UTC",
              "transaction_hash": "3a0e50fcc9dafd9bcc963ff5183537b5cc4a5c02e55f61811bd557466df8b6e4",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "f73e295b274ef8be5eb6c401cd35fb6fe33c4077",
      "block_hash": "b62c611a2b191dfab9b806827f74d2d57d03f0212830608d0b7b9475de8e6997",
      "block_timestamp": "2025-04-15 18:13:27 UTC",
      "block_number": "94567",
      "transaction_hash": "ba660b6739dfeacd36eea1e0fc9bea42ec85f2799ef76fa8274225c7a6f8474b",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "f73e295b274ef8be5eb6c401cd35fb6fe33c4077",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Collateral Token 2",
      "_symbol": "MKCT2",
      "_totalSupply": 1e+23,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "f73e295b274ef8be5eb6c401cd35fb6fe33c4077",
              "value": "100000000000000000000000",
              "address": "f73e295b274ef8be5eb6c401cd35fb6fe33c4077",
              "creator": "BlockApps",
              "block_hash": "b62c611a2b191dfab9b806827f74d2d57d03f0212830608d0b7b9475de8e6997",
              "block_number": "94567",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-15 18:13:27 UTC",
              "transaction_hash": "ba660b6739dfeacd36eea1e0fc9bea42ec85f2799ef76fa8274225c7a6f8474b",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "f837504bf30a041ba565458bd79a5865fed03eac",
      "block_hash": "05fd4e790953d9cb07200823327f55ae125dfd9a02224441d8b01460f36e014a",
      "block_timestamp": "2025-04-15 23:55:21 UTC",
      "block_number": "94592",
      "transaction_hash": "f828bf97bdd98c77877832dfe000c73e7a9df1bea5fe7aaf85f4bfdd8edba894",
      "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
      "creator": "Maya Konaka",
      "root": "f837504bf30a041ba565458bd79a5865fed03eac",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Liquidity Token 12",
      "_symbol": "MKLQ12",
      "_totalSupply": 5e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "f837504bf30a041ba565458bd79a5865fed03eac",
              "value": "5000000000000000000000",
              "address": "f837504bf30a041ba565458bd79a5865fed03eac",
              "creator": "BlockApps",
              "block_hash": "05fd4e790953d9cb07200823327f55ae125dfd9a02224441d8b01460f36e014a",
              "block_number": "94592",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-15 23:55:21 UTC",
              "transaction_hash": "f828bf97bdd98c77877832dfe000c73e7a9df1bea5fe7aaf85f4bfdd8edba894",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          }
      ]
  },
  {
      "address": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
      "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
      "block_timestamp": "2025-04-17 01:14:51 UTC",
      "block_number": "94743",
      "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Liquidity Token 11",
      "_symbol": "MKLQ11",
      "_totalSupply": 7e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "value": "6000000000000000000000",
              "address": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "creator": "BlockApps",
              "block_hash": "5e260892dd930f3186548b0080242b8fa22b3d8cb25ac4f54ae2705243bcd1b3",
              "block_number": "94721",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-16 20:59:49 UTC",
              "transaction_hash": "0d4b24bf7dd8574929a924a2964bf658dbbb72de6eee861f18795833c14a1b30",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "value": "1000000000000000000000",
              "address": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "creator": "BlockApps",
              "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
              "block_number": "94743",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 01:14:51 UTC",
              "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "d31c82f1fc3dce24b54deffbc3fb08151f3e6742",
              "root": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "value": "0",
              "address": "3e63605525704ee82855f90f4ed3d9cef8afcc8e",
              "creator": "BlockApps",
              "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
              "block_number": "94743",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 01:14:51 UTC",
              "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
      "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
      "block_timestamp": "2025-04-17 01:14:51 UTC",
      "block_number": "94743",
      "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "MK Collateral Token 21",
      "_symbol": "MKCT21",
      "_totalSupply": 5e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "value": "1999000000000000001000",
              "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "creator": "BlockApps",
              "block_hash": "d9a6c9f9f971d3a6332da06f9cb32ccd1f770a654b5fbf0c937ae44b1337ec08",
              "block_number": "94719",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-16 20:53:13 UTC",
              "transaction_hash": "a5b2034df193a78e7f8c77e8abb8a92948955db7e86b75cc93a45a4ca58755e3",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "20b7f5f9d7bda4e8a740c1f4b82171c20b6bd142",
              "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "value": "1000000000000000000",
              "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "creator": "BlockApps",
              "block_hash": "64fbadaefb3763d802ac8b6ad83c673888bf84dcf616490bd0415c26066bcf52",
              "block_number": "94657",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-16 17:10:14 UTC",
              "transaction_hash": "b91d34a407a70d5a1dc59f2da17848c3680b4af41a1a22b900cb8bfa02e1461b",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "b6590372257bd28b76ee434409940d07dfe01d16",
              "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "value": "999999999999999999000",
              "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "creator": "BlockApps",
              "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
              "block_number": "94743",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 01:14:51 UTC",
              "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "d31c82f1fc3dce24b54deffbc3fb08151f3e6742",
              "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "value": "2000000000000000000000",
              "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "creator": "BlockApps",
              "block_hash": "d9a6c9f9f971d3a6332da06f9cb32ccd1f770a654b5fbf0c937ae44b1337ec08",
              "block_number": "94719",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-16 20:53:13 UTC",
              "transaction_hash": "a5b2034df193a78e7f8c77e8abb8a92948955db7e86b75cc93a45a4ca58755e3",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "value": "0",
              "address": "cdecca31523c21cf2a51c6ee76a730338b216864",
              "creator": "BlockApps",
              "block_hash": "e62805618c170317bc8db10624cd381561c36361f10c5bcec01d5daba6202ed6",
              "block_number": "94743",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 01:14:51 UTC",
              "transaction_hash": "c7cbe62b0f40f78503a9a9a8621494e8a09b3696596ebda3f3544177665148e5",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
      "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
      "block_timestamp": "2025-04-18 15:49:47 UTC",
      "block_number": "94914",
      "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "Silver",
      "_symbol": "SILV",
      "_totalSupply": 1e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "value": "300000000000000000000",
              "address": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "creator": "BlockApps",
              "block_hash": "c90fb18b67d0215bd8747e9526f709ba88c97533620153ae237944d260414bb8",
              "block_number": "94912",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 14:45:48 UTC",
              "transaction_hash": "13ec16da65c9473e63d9bc78a76a45f09489f2c079daf826e30d3798b8c9500e",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "value": "510000000000000000000",
              "address": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "creator": "BlockApps",
              "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
              "block_number": "94914",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 15:49:47 UTC",
              "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "b6590372257bd28b76ee434409940d07dfe01d16",
              "root": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "value": "100000000000000000000",
              "address": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "creator": "BlockApps",
              "block_hash": "4f9f0fed89a1bfa1a02044c0f2c92779ae79e7b0aeb3ae34d8eeedd7c4eaf614",
              "block_number": "94823",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 20:20:38 UTC",
              "transaction_hash": "fc7580cbde89b38687ef1471b558afe5ec96abdc0d5cd055b6e73bd76c75ebf6",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "43a26699262fce5d0020a16da159e0e22ea3c5e1",
              "root": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "value": "90000000000000000000",
              "address": "bc1fd7e6e67ec3e1475c873ca3c9513baf8a36b3",
              "creator": "BlockApps",
              "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
              "block_number": "94914",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 15:49:47 UTC",
              "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
      "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
      "block_timestamp": "2025-04-18 15:49:47 UTC",
      "block_number": "94914",
      "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "WBTC",
      "_symbol": "WBTC",
      "_totalSupply": 1e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "value": "480000000000000000000",
              "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "creator": "BlockApps",
              "block_hash": "e87f9acaa4012bb7853ec2e56063563c0242379a521f813b93fe5aa82d6e6178",
              "block_number": "94909",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 14:42:04 UTC",
              "transaction_hash": "ef1ba642f66cc35476068a500fcf3f5a8223789a97d57a91ad32dba8983282ec",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "value": "498500000000000000000",
              "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "creator": "BlockApps",
              "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
              "block_number": "94914",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 15:49:47 UTC",
              "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "b6590372257bd28b76ee434409940d07dfe01d16",
              "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "value": "10000000000000000000",
              "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "creator": "BlockApps",
              "block_hash": "6037c8de4d3c29d89f0697629ad7ffd2c9b1fab458ae8763adcb3d4ab0c87a41",
              "block_number": "94809",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 17:54:54 UTC",
              "transaction_hash": "a321b61549576a7f4da5a9996f1c545863d57174e3b88a41ac9c026948408371",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "43a26699262fce5d0020a16da159e0e22ea3c5e1",
              "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "value": "10000000000000000000",
              "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "creator": "BlockApps",
              "block_hash": "e87f9acaa4012bb7853ec2e56063563c0242379a521f813b93fe5aa82d6e6178",
              "block_number": "94909",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 14:42:04 UTC",
              "transaction_hash": "ef1ba642f66cc35476068a500fcf3f5a8223789a97d57a91ad32dba8983282ec",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "42fac7df1a791b73419d57e66f809f4790c23c34",
              "root": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "value": "1500000000000000000",
              "address": "e25c77e804c31a31b32fbb4e3bfcca24e924091d",
              "creator": "BlockApps",
              "block_hash": "b37b2b4644dba2672b0c1df788f3223a7ab3f49996681bc5b68637888d03ece9",
              "block_number": "94914",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 15:49:47 UTC",
              "transaction_hash": "4a5daf20062f5f5219e51d116c34def0bf9a1422cd35d398d114b0abd3667da3",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "6db50964687912322d860c3f96128230d493bb51",
      "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
      "block_timestamp": "2025-04-21 21:30:19 UTC",
      "block_number": "95028",
      "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "6db50964687912322d860c3f96128230d493bb51",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "ETH",
      "_symbol": "ETH",
      "_totalSupply": 1e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "350000000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "979c62044a58046ea4e4a40aa37143d122a716175e87a6a46ee0719268f46a77",
              "block_number": "95022",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:23:55 UTC",
              "transaction_hash": "b584ea54cdef1f44086fd482e899f44b64a62637d4e7f30fadc3be11ff36698c",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "d31c82f1fc3dce24b54deffbc3fb08151f3e6742",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "0",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "612c231d40452e992130376be5f3559d75e216adbcc6b1e17e0f19de130aa458",
              "block_number": "94817",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 19:44:20 UTC",
              "transaction_hash": "bdb083f1cb3422cc52c751f681601c32a6275a6fb58218dd6e4714bd0d26687e",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "498500000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
              "block_number": "95028",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:30:19 UTC",
              "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "b6590372257bd28b76ee434409940d07dfe01d16",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "50000000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "c017030e2c55eff3d7f76da0baab6ba1bde7f5be146d6696c3cecc73778f69c7",
              "block_number": "94811",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 17:56:15 UTC",
              "transaction_hash": "9d81eb9c6cc45494037e6cef9af7b379bbdd35b6e948d53344f18dbe4fbb1ec8",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "43a26699262fce5d0020a16da159e0e22ea3c5e1",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "50000000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "597dad75faee93140794e79777e68a4af40bd706416d145928a1f58a5193a4a6",
              "block_number": "94907",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 14:40:49 UTC",
              "transaction_hash": "2de9f98e4bb791dc94795cdd2a11c83ff18914cd424e341fe5231d29b48a5b79",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "42fac7df1a791b73419d57e66f809f4790c23c34",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "0",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "af22c58a8e7d4053b0250dab951024af899c0cccb26f394ff8a78018b911ce94",
              "block_number": "94870",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 22:15:56 UTC",
              "transaction_hash": "8d8862566d32df2fdda4ae0de03fb518b437f45943de0f34a4e93bb31fdb1248",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "7c3e5cdc2b2c436a622b57c5301f5d942219741f",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "50000000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "979c62044a58046ea4e4a40aa37143d122a716175e87a6a46ee0719268f46a77",
              "block_number": "95022",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:23:55 UTC",
              "transaction_hash": "b584ea54cdef1f44086fd482e899f44b64a62637d4e7f30fadc3be11ff36698c",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "0f1acfba4ad90fa9f8cd42fd9ead7ca7c8258713",
              "root": "6db50964687912322d860c3f96128230d493bb51",
              "value": "1500000000000000000",
              "address": "6db50964687912322d860c3f96128230d493bb51",
              "creator": "BlockApps",
              "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
              "block_number": "95028",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:30:19 UTC",
              "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
      "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
      "block_timestamp": "2025-04-21 21:30:19 UTC",
      "block_number": "95028",
      "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
      "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
      "creator": "Maya Konaka",
      "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
      "contract_name": "Maya Konaka-CollateralToken",
      "data": {
          "_owner": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
          "decimals": "18",
          "ownerCommonName": "Maya Konaka"
      },
      "_name": "Gold",
      "_symbol": "GOLD",
      "_totalSupply": 1e+21,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "799e893b812c81704a4e1346fbb2c7a7c50828a7",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "350000000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "696dc999c1f6edb67f5afb308e8b7770834fa2cb9d813ee5a8a205edf62c4973",
              "block_number": "95021",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:23:13 UTC",
              "transaction_hash": "2a05a8dcdaa05c4efb3d9ec7fd9e99591d794fa0998409bc68dd77f67e9e10fa",
              "transaction_sender": "799e893b812c81704a4e1346fbb2c7a7c50828a7"
          },
          {
              "key": "453b40e2399ed85e7b309152a15772c8a8e81bd8",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "496500000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
              "block_number": "95028",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:30:19 UTC",
              "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "b6590372257bd28b76ee434409940d07dfe01d16",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "50000000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "c581f6f57276b2f758be4b1ff49b6bf897ccba468458b47414d55d825e33d264",
              "block_number": "94816",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 19:38:53 UTC",
              "transaction_hash": "5ea9412d8e393301496ab85a274df656cffdff5d38a3eed146be00e40b76c998",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "d31c82f1fc3dce24b54deffbc3fb08151f3e6742",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "3000000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "2e9a92c09a468874e25f1439d2567d009a2b35d3d5aeb5461131bdc50c127ded",
              "block_number": "94822",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 20:19:44 UTC",
              "transaction_hash": "97f6612de7f07acf12ee4f0ff7dd9b2e3208f660fde45986304932c5eefbad77",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "43a26699262fce5d0020a16da159e0e22ea3c5e1",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "50000000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "af22c58a8e7d4053b0250dab951024af899c0cccb26f394ff8a78018b911ce94",
              "block_number": "94870",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-17 22:15:56 UTC",
              "transaction_hash": "8d8862566d32df2fdda4ae0de03fb518b437f45943de0f34a4e93bb31fdb1248",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "42fac7df1a791b73419d57e66f809f4790c23c34",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "1500000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "dee735e0050c8a11bb6791a81a1e44604f22303f50a4ede5130b8d43c56a4f85",
              "block_number": "94902",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-18 14:01:12 UTC",
              "transaction_hash": "f567d46ce06ea0aba587799556cb415efa550b14528bba3ee9882a32710874f7",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          },
          {
              "key": "7c3e5cdc2b2c436a622b57c5301f5d942219741f",
              "root": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "value": "49000000000000000000",
              "address": "f0e2e8d82f977bea597bf02263473a02721a7442",
              "creator": "BlockApps",
              "block_hash": "00fe8635f09a1883c2719fe0629c64fd4a85f51f5f899dcbc4df7cdeae07fa8a",
              "block_number": "95028",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-21 21:30:19 UTC",
              "transaction_hash": "48118c1a8f46f71b9478af16605662e5b3291eb42826af14a5e55cf8d30f6e46",
              "transaction_sender": "453b40e2399ed85e7b309152a15772c8a8e81bd8"
          }
      ]
  },
  {
      "address": "0d6fb79c076a1cb6f5631d7d54943c9e4e101dcd",
      "block_hash": "c2459b068f32427388c999cb8680b3a705fce9cd9cecc16a82321418ad87318d",
      "block_timestamp": "2025-04-24 21:49:55 UTC",
      "block_number": "95101",
      "transaction_hash": "12572eb6ba7770dab3dfae879e90d95a1fa4a2263c0ec483dadd129d455764a2",
      "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
      "creator": "mercata_usdst",
      "root": "91b7ff2cce57ba17439b73132617c58075055b23",
      "contract_name": "mercata_usdst-SimplePoolFactory-Pool",
      "data": {
          "token": "1f0e5fa82e9db88aba1a3f6844085c731a9d8db0",
          "locked": "False",
          "stablecoin": "8fba5de6eee3f216668b729179f0a244dc2ec48b"
      },
      "_name": "Simple LP",
      "_symbol": "SLP",
      "_totalSupply": 3.399999999999932e+25,
      "BlockApps-Mercata-ERC20-_balances": [
          {
              "key": "353848ae1512ae8e02b50ee7fa78b1167d09f577",
              "root": "91b7ff2cce57ba17439b73132617c58075055b23",
              "value": "33999999999999320000000000",
              "address": "0d6fb79c076a1cb6f5631d7d54943c9e4e101dcd",
              "creator": "BlockApps",
              "block_hash": "bda5aebf7a2843c2c3f9b0d2dad7c2c0a01aa6bd4653ce707070996e6fc2ab93",
              "block_number": "94088",
              "contract_name": "ERC20",
              "collectionname": "_balances",
              "collectiontype": "Mapping",
              "block_timestamp": "2025-04-04 16:00:46 UTC",
              "transaction_hash": "bb1a2738451869736e57c1b2e02ec501b84ef77501ccbe3a482fe5d4fe86803d",
              "transaction_sender": "353848ae1512ae8e02b50ee7fa78b1167d09f577"
          }
      ]
  }
]
