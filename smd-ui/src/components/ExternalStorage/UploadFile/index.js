import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog } from '@blueprintjs/core';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import { closeUploadModal, resetError } from './uploadFile.actions';
import { toasts } from '../../Toasts';
import { isOauthEnabled } from '../../../lib/checkMode';
import { fetchAccounts } from '../../Accounts/accounts.actions';
import UploadForm from './UploadForm';
import UploadData from './UploadData';

import './uploadFile.css';

class UplaodFile extends Component {

  componentWillReceiveProps(nextProps) {
    if (nextProps.uploadError) {
      toasts.show({ message: nextProps.uploadError });
      this.props.resetError();
    }
  }

  componentDidMount() {
    mixpanelWrapper.track("external_storage_loaded");
    !isOauthEnabled() && this.props.fetchAccounts(true, false);
  }

  render() {
    let result = this.props.result;

    return (
      <div>
        <Dialog
          isOpen={this.props.isOpen}
          onClose={() => {
            mixpanelWrapper.track('close_upload_modal');
            this.props.closeUploadModal();
          }}
          iconName={result ? 'saved' : 'pt-icon-upload'}
          title={result ? 'URI Upload Success' : 'Upload & attest'}
          className="pt-dark upload-dialog"
        >
          {result ? <UploadData result={this.props.result} closeModal={() => this.props.closeUploadModal()} /> : <UploadForm />}
        </Dialog>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.uploadFile.isOpen,
    uploadError: state.uploadFile.error,
    result: state.uploadFile.result
  };
}

const connected = connect(
  mapStateToProps,
  {
    closeUploadModal,
    resetError,
    fetchAccounts
  }
)(UplaodFile);

export default withRouter(connected);