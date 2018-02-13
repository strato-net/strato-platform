import React, { Component } from 'react';
import { closeCLIOverlay } from './cli.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { downloadPDFFile } from '../../lib/fileHandler'
import cli from '../../cli.pdf'

import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CLI extends Component {

  render() {
    return (
      <div>
        <form>
          <Dialog
            iconName="download"
            isOpen={this.props.isTokenOpen}
            onClose={this.props.closeCLIOverlay}
            title="How to Deploy an App on STRATO"
            className="pt-dark"
          >
            <div>
              <div className="pt-dialog-body">
                <div className="pt-form-group">
                  <div className="pt-form-group pt-intent-danger">
                    <div className="pt-form-content">
                      The ​ bloc CLI​ is designed to make it easy for developers to download, deploy, and manage their
                      apps from the command line. The ​ bloc CLI​ is a Node.js module that will allow users to download,
                      zip, and deploy ​ App Bundles​ and services to STRATO, as well as to monitor their account
                      balance. The ​ bloc CLI​ is intended to be used in conjunction with the ​ STRATO Public Web App.
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-dialog-footer">
                <div className="pt-dialog-footer-actions">
                  <Button
                    intent={Intent.PRIMARY}
                    onClick={() => {
                      mixpanelWrapper.track('Add_App_click');
                      downloadPDFFile('cli.pdf', cli);
                    }}
                    text="Download"
                  />
                </div>
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isTokenOpen: state.cli.isTokenOpen,
  };
}

export default withRouter(connect(mapStateToProps, {
  closeCLIOverlay,
})(CLI));
