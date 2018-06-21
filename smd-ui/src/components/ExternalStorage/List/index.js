import React, { Component } from 'react';
import { parseDateFromString } from '../../../lib/dateUtils';
import HexText from '../../HexText';

class List extends Component {

  render() {
    let list = this.props.uploadList.length && this.props.uploadList.map(
      function (list, i) {
        return (
          <tr key={i}>
            <td>
              <small>{list.uri}</small>
            </td>
            <td className="text-right">
              <small>
                <HexText value={list.contractAddress} classes="smd-pad-2" />
              </small>
            </td>
            <td>
              <small>{parseDateFromString(list.createdAt)}</small>
            </td>
          </tr>
        )
      }
    );

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <table className="pt-table pt-interactive pt-condensed pt-striped upload-list">
          <thead>
            <tr>
              <th><h5>Document</h5></th>
              <th><h5>Owner</h5></th>
              <th><h5>Uploaded</h5></th>
            </tr>
          </thead>

          <tbody>
            {list || <tr><td colSpan={3}>No Data</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }
}

export default List;
