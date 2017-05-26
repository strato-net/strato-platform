import React, {Component} from 'react';
import {openOverlay, closeOverlay} from './createContract.actions';
import {Button, Dialog, Intent} from '@blueprintjs/core';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

import './CreateContract.css';

class CreateContract extends Component {

  render() {
    return (<div>
        <Button onClick={this.props.openOverlay} style={{"margin": "1.5px"}} className="pt-intent-primary pt-icon-add"
                text="Create Contract"/>
        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeOverlay}
          title="Create New Contract"
          className=""
        >
          {/*FIXME Text input divs are not positioned sensibly */}
          <div className="pt-dialog-body">
            <div className="pt-form-group">
              <div className="input">
                <label className="pt-label" for="input">
                  Contract Name
                </label>
                <div className="pt-form-content">
                  <input id="input" className="pt-input" style={{"width": "300px;"}} placeholder="Contract Name" type="text" dir="auto" />
                  <div className="pt-form-helper-text">Pick a username</div>
                </div>
              </div>

              <div className="input">
                <label className="pt-label" for="input">
                  Contract Input
                </label>
                <div className="pt-form-content">
                  <input id="input" className="pt-input" style={{"width": "300px;"}} placeholder="Contract Input" type="text" dir="auto" />
                  <div className="pt-form-helper-text">Pick a password</div>
                </div>
              </div>

              <div className="input">
                <label className="pt-label" for="input">
                  Contract Input
                </label>
                <div className="pt-form-content">
                  <input id="input" className="pt-input" style={{"width": "300px;"}} placeholder="Contract Input" type="text" dir="auto" />
                  <div className="pt-form-helper-text">Confirm your password</div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions">
              <Button text="Cancel" onClick={this.props.closeOverlay} />
              <Button
                intent={Intent.PRIMARY}
                onClick={this.props.closeOverlay}
                text="Create Contract"
              />
            </div>
          </div>
        </Dialog>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isOpen: state.createContract.isOpen
  };
}

export default withRouter(connect(mapStateToProps, {openOverlay, closeOverlay})(CreateContract));
