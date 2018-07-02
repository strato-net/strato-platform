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
            <td>
              <small>
                <HexText value={list.contractAddress} classes="smd-pad-2" />
              </small>
            </td>
            <td>
              <small>
                <HexText value={list.hash} classes="smd-pad-2" />
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
        <table className="pt-table pt-interactive pt-condensed pt-striped upload-list" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th width="40%"><h5>Document</h5></th>
              <th width="20%"><h5>Address</h5></th>
              <th width="20%"><h5>Hash</h5></th>
              <th width="20%"><h5>Uploaded</h5></th>
            </tr>
          </thead>

          <tbody>
            {list || <tr><td colSpan={4}>No Data</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }
}

export default List;
