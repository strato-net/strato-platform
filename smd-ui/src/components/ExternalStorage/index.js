import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { openUploadModal } from './UploadFile/uploadFile.actions';
import UploadFile from './UploadFile';
import List from './List';
import { fetchUploadList } from './externalStorage.actions';

import './externalStorage.css';

class ExternalStorage extends Component {

  componentDidMount() {
    this.props.fetchUploadList();
  }

  render() {
    return (
      <div className="container-fluid pt-dark external-storage">
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>External Storage</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 content">
            <Button
              onClick={() => {
                mixpanelWrapper.track('open_upload_modal');
                this.props.openUploadModal();
              }}
              className="pt-intent-primary button-spacing pt-icon-upload"
              text="Upload" />
            <Button
              onClick={() => {

              }}
              className="pt-intent-primary button-spacing pt-icon-tick"
              text="Attest" />
            <Button
              onClick={() => {

              }}
              className="pt-intent-primary button-spacing pt-icon-info-sign"
              text="Verify" />
            <Button
              onClick={() => {

              }}
              className="pt-intent-primary button-spacing pt-icon-download"
              text="Downlaod" />
          </div>
          <UploadFile />
          <List uploadList={this.props.uploadList} />
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    uploadList: state.externalStorage.uploadList
  };
}

const connected = connect(mapStateToProps, {
  openUploadModal,
  fetchUploadList
})(ExternalStorage)

export default withRouter(connected);
