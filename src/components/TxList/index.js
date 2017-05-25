import React, {Component} from 'react';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css';
import './TxList.css';

class TxList extends Component {

  render() {
    const tx = [{
      "transactionType": "Contract",
      "origin": "API",
      "next": "",
      "hash": "3ec8d41dd39f9bcb4f1e93a89e89d9d96dfb6259518fe09868f2a5c4e39bb032",
      "gasLimit": 90000000,
      "codeOrData": "606060405260978060106000396000f360606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056",
      "gasPrice": 50000000000,
      "value": "0",
      "from": "877aa5e89cd143f0e8d33eeced6a35ae30cdcd6",
      "blockNumber": 7,
      "r": "a90ee66c8faf6ce19a5e0496fc809cc1d6984d8636afc9c8a8b2ac381cabc014",
      "s": "5a5e4ac0d5b1d8cde2662075ee00ecd2da47faae2729252c92237057c6e5b32a",
      "timestamp": "2017-05-24 06:28:59.308342 UTC",
      "v": "1c",
      "nonce": 0
    }, {
      "transactionType": "Transfer",
      "origin": "API",
      "next": "",
      "hash": "286a2933207da63edb0039b3a5e77240b5d4d6f59184d73114b67eeabd337780",
      "gasLimit": 100000,
      "codeOrData": "",
      "gasPrice": 50000000000,
      "to": "877aa5e89cd143f0e8d33eeced6a35ae30cdcd6",
      "value": "1000000000000000000000",
      "from": "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859",
      "blockNumber": 6,
      "r": "379ea04638c2acce337d0bf53855f1fe0a8039a32e11f3889f3ce115958874d0",
      "s": "5debacd382e8031d246ee4b752611e782648d801f9a9f460816b750a7f3b852f",
      "timestamp": "2017-05-24 02:28:58.150829 UTC",
      "v": "1c",
      "nonce": 4
    }, {
      "transactionType": "Transfer",
      "origin": "API",
      "next": "",
      "hash": "d080b8b45239e00c23b566e9e1e8c1eb5932f031bfdaadac5d1b79a9a28d69d3",
      "gasLimit": 21000,
      "codeOrData": "",
      "gasPrice": 50000000000,
      "to": "4a29fd035d37c2c7789379a012288513748f34cc",
      "value": "20000000000000000000",
      "from": "c408f57da163fd874b2c1aa281e3a9054cea5024",
      "blockNumber": 5,
      "r": "bbf069616e445d243ed586cfe2b06da4e2cf10d5c4fd93570b76c296634d5f7d",
      "s": "80a0b0318399c10a04674edd7fb372068c5fb38e29a57e70ae6e3248c5135543",
      "timestamp": "2017-05-24 11:28:55.996483 UTC",
      "v": "1b",
      "nonce": 0
    }, {
      "transactionType": "Transfer",
      "origin": "API",
      "next": "",
      "hash": "66cc58c861dc1f564bba81fc86ea7470b465e7a0ff17b5e6437c6b5174624c75",
      "gasLimit": 100000,
      "codeOrData": "",
      "gasPrice": 50000000000,
      "to": "4a29fd035d37c2c7789379a012288513748f34cc",
      "value": "1000000000000000000000",
      "from": "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859",
      "blockNumber": 4,
      "r": "daf0af02f15f6136a94cd992e1903b805f9654deb3d371c8241a9d844388c9ef",
      "s": "5c58b5e2f1f17d6a98343c7f5a64429e085e2e405e7f9d9a4d982cb20c86d7e5",
      "timestamp": "2017-05-24 23:28:54.846663 UTC",
      "v": "1c",
      "nonce": 3
    }, {
      "transactionType": "Transfer",
      "origin": "API",
      "next": "",
      "hash": "1e456835ad25c4310b7c84f1d43ac19ee4e38c2fc10391cc05a58712e1823f4e",
      "gasLimit": 100000,
      "codeOrData": "",
      "gasPrice": 50000000000,
      "to": "c408f57da163fd874b2c1aa281e3a9054cea5024",
      "value": "1000000000000000000000",
      "from": "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859",
      "blockNumber": 3,
      "r": "c21bdcd348a57c4c2bbb38186e0f7b340db72891001d218d1711cac2c4d1f315",
      "s": "47630ac7faf7a91c5ef1ed103da2ef9883ac54edadf20afdc440eb8e9b0a3e73",
      "timestamp": "2017-05-24 14:28:53.652253 UTC",
      "v": "1b",
      "nonce": 2
    }]

    const txRows = tx.map(function (tx) {
      const date = new Date(tx.timestamp);
      var hours = date.getHours()
      var ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      var dateStr = hours.toString()
        + ":" + date.getMinutes().toString()
        + " " + ampm
        + " " + date.getMonth().toString()
        + "/" + date.getDate().toString()
        + "/" + date.getFullYear().toString();
      return <tr className="tx-row">
        <td className="col-sm">{tx.transactionType}</td>
        <td className="col-sm">{tx.value}</td>
        <td className="col-sm">{tx.from}</td>
        <td className="col-sm">{tx.to === undefined ? "No recipient" : tx.to}</td>
        <td className="col-sm">{dateStr}</td>
      </tr>
    })

    return (
      <div className="row accounts-row">
        <div>
          <table className="pt-table pt-interactive accounts-table">
            <thead>
            <th className="col-sm"><h4>Transaction Type</h4></th>
            <th className="col-sm"><h4>Value</h4></th>
            <th className="col-sm"><h4>Sender</h4></th>
            <th className="col-sm"><h4>Recipient</h4></th>
            <th className="col-sm"><h4>Timestamp</h4></th>
            </thead>

            <tbody>
            {txRows}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

export default TxList;