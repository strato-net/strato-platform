import React, { Component } from 'react';
import { Button, Intent } from '@blueprintjs/core';

class UploadData extends Component {

  render() {
    let data = this.props.result;

    return (
      <div>
        <div className="pt-dialog-body">

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> Contract Address </label>
            </div>
            <div className="col-sm-8">
              <label> {data.contractAddress} </label>
            </div>
          </div>

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> URI </label>
            </div>
            <div className="col-sm-8">
              <label> {data.uri} </label>
            </div>
          </div>

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> Description </label>
            </div>
            <div className="col-sm-8">
              <label> {data.metadata} </label>
            </div>
          </div>

        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center">
            <Button
              intent={Intent.PRIMARY}
              onClick={() => this.props.closeModal()}
              text="Close"
            />
          </div>
        </div>
      </div>
    )
  }
}

export default UploadData;