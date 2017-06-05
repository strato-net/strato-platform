import React, {Component} from 'react';
import {openOverlay, closeOverlay, createContract, compileContract} from './createContract.actions';
import {Button, Dialog, Intent, Spinner, InputGroup} from '@blueprintjs/core';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

import './CreateContract.css';

var payload = {username: '', password: '', fileText: '', filename: "Upload Smart Contract(.sol)"};
var inputs = {}
class CreateContract extends Component {

  handleFileUpload(e) {
    var file = e.target.files[0];
    var reader = new FileReader();
    payload.filename = file.name;
    reader.onload = function (event) {
      payload.fileText = event.target.result;
      payload.fileText = payload.fileText.replace(/\r?\n|\r/g, " ");
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
    payload["arguments"] = inputs;
    console.log(inputs);
    this.props.createContract(payload);
    payload = {username: '', password: '', fileText: '', filename: "Upload Smart Contract(.sol)"};
    inputs = {};
  };

  handleCompile = () => {
    this.props.compileContract(payload);
  }

  render() {
    let src = this.props.abi === undefined ? undefined : this.props.abi.src;
    let args = src === undefined ?
      <div className="input">
        <label className="pt-label">
          Waiting for Compliation...
        </label>
      </div> :
      (
      Object.values(src).map(val => {
          if (val.constr !== undefined) {
            return Object.getOwnPropertyNames(val.constr).map(arg => {
              return (<div className="input">
                <label className="pt-label">
                  {arg}
                </label>
                <div className="pt-form-content">
                  <InputGroup id="input-b" className="form-width" placeholder={arg}
                              onChange={(e) => {
                                inputs[arg] = e.target.value;
                              }}
                              type="text" dir="auto"/>
                  <div className="pt-form-helper-text">Enter an argument</div>
                </div>
              </div>);
            });
          }
        }
      )
    );

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

              {args}
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions">
              <Button text="Cancel" onClick={this.props.closeOverlay}/>
              <Button
                className="pt-icon-code"
                intent={Intent.WARNING}
                onClick={this.handleCompile}
                text="Compile Contract"
              />
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
    spinning: state.createContract.compileSuccess,
    response: state.createContract.response,
    abi: state.createContract.abi,
  };
}

export default withRouter(connect(mapStateToProps, {
  openOverlay,
  closeOverlay,
  createContract,
  compileContract
})(CreateContract));
