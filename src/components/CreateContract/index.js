import React, {Component} from 'react';
import {openOverlay, closeOverlay, createContract} from './createContract.actions';
import {Button, Dialog, Intent, Spinner, InputGroup} from '@blueprintjs/core';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

import './CreateContract.css';

var payload = { username: '', password: '', fileText: '', filename: "Upload Smart Contract(.sol)"}

class CreateContract extends Component {

  handleFileUpload(e) {
    var file = e.target.files[0];
    var reader = new FileReader();
    payload.filename = file.name;
    reader.onload = function(event) {
      // The file's text will be printed here
      payload.fileText = event.target.result;
      payload.fileText = payload.fileText.replace(/\r?\n|\r/, " ");
    };

    reader.readAsText(file);
  }

  handleUsernameChange = (e) => {
    payload.username = e.target.value;
  };

  handlePasswordChange = (e) => {
    payload.password = e.target.value;
  };

  handleSubmit = () => {
    this.props.createContract(payload);
    this.props.closeOverlay();
    payload = { username: '', password: '', fileText: '', filename: "Upload Smart Contract(.sol)" }
  };

  render() {
    return (<div className="smd-pad-16">
        <Button onClick={this.props.openOverlay} className="pt-intent-primary pt-icon-add"
                text="Create Contract"/>
        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeOverlay}
          title="Create New Contract"
          className="pt-dark"
        >
          
          <div className="pt-dialog-body">
            <div className="pt-form-group">
              <div className="input">
                <label className="pt-label">
                  Username
                </label>
                <div className="pt-form-content">
                  <InputGroup id="input-a" className="form-width" placeholder="Username"
                              onChange={this.handleUsernameChange}
                              type="text" dir="auto"/>
                  <div className="pt-form-helper-text">Enter your username</div>
                </div>
              </div>

              <div className="input">
                <label className="pt-label">
                  Password
                </label>
                <div className="pt-form-content">
                  <InputGroup id="input-b" className="form-width" placeholder="Password"
                              onChange={this.handlePasswordChange}
                              type="text" dir="auto"/>
                  <div className="pt-form-helper-text">Enter your password</div>
                </div>
              </div>

              <div className="input">
                <label style={{"margin": "0.5%"}} className="pt-file-upload">
                  <InputGroup type="file" onChange={this.handleFileUpload}/>
                  <span className="pt-file-upload-input">{payload.filename}</span>
                </label>
              </div>
            </div>

            <div>
              <div className="col-sm-3"></div>
              <div className="col-sm-6">{this.props.spinning ? <Spinner className="text-center"/> : ''}</div>
              <div className="col-sm-3"></div>
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions">
              <Button text="Cancel" onClick={this.props.closeOverlay} />
              <Button
                intent={Intent.PRIMARY}
                onClick={this.handleSubmit}
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
    isOpen: state.createContract.isOpen,
    spinning: state.createContract.spinning,
    response: state.createContract.response,
  };
}

export default withRouter(connect(mapStateToProps, {openOverlay, closeOverlay, createContract})(CreateContract));
