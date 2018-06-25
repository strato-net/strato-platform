import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { openUploadModal } from './UploadFile/uploadFile.actions';
import UploadFile from './UploadFile';
import List from './List';
import Attest from './Attest';
import Verify from './Verify';
import Download from './Download';
import { fetchUploadList } from './externalStorage.actions';
import { openAttestModal } from './Attest/attest.action';
import { openVerifyModal } from './Verify/verify.action';

import './externalStorage.css';
import { openDownloadModal } from './Download/download.action';

class ExternalStorage extends Component {

  componentDidMount() {
    this.props.fetchUploadList();
  }

  render() {
    return (
      <div className="container-fluid pt-dark external-storage">
        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>External Storage</h3>
          </div>
          <div className="col-sm-8 text-right">
            <Button
              onClick={() => {
                mixpanelWrapper.track('open_upload_modal');
                this.props.openUploadModal();
              }}
              className="pt-intent-primary button-spacing pt-icon-upload"
              text="Upload" />
            <Button
              onClick={() => {
                mixpanelWrapper.track('open_attest_modal');
                this.props.openAttestModal();
              }}
              className="pt-intent-primary button-spacing pt-icon-tick"
              text="Attest" />
            <Button
              onClick={() => {
                mixpanelWrapper.track('open_verify_modal');
                this.props.openVerifyModal();
              }}
              className="pt-intent-primary button-spacing pt-icon-info-sign"
              text="Verify" />
            <Button
              onClick={() => {
                mixpanelWrapper.track('open_download_modal');
                this.props.openDownloadModal();
              }}
              className="pt-intent-primary button-spacing pt-icon-download"
              text="Downlaod" />
          </div>
        </div>
        <List uploadList={this.props.uploadList} />
        <UploadFile />
        <Attest />
        <Verify />
        <Download />
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
  fetchUploadList,
  openAttestModal,
  openVerifyModal,
  openDownloadModal
})(ExternalStorage)

export default withRouter(connected);
