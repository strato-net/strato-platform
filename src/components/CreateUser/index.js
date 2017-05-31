import React, {Component} from 'react';
import {openOverlay, closeOverlay, createUser} from './createUser.actions';
import {Button, Dialog, Intent, InputGroup, Spinner} from '@blueprintjs/core';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

import './CreateUser.css';
const form = {}
class CreateUser extends Component {

  handleUsernameChange(e) {
    form.username = e.target.value;
  }

  handlePasswordChange(e) {
    form.password = e.target.value;
  }

  submit = () => {
    this.props.createUser(form.username === undefined ? '' : form.username, form.password === undefined ? '' : form.password);
  }

  render() {
    return (<div>
        <Button onClick={this.props.openOverlay} style={{"margin": "1.5px"}} className="pt-intent-primary pt-icon-add"
                text="Create User"/>
        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeOverlay}
          title="Create New User"
          className=""
        >
          <form>
            {/*FIXME Text input divs are not positioned sensibly */}
            <div className="pt-dialog-body">
              <div className="pt-form-group">

                <div className="input">
                  <label className="pt-label" for="input-a">
                    Username
                  </label>
                  <div className="pt-form-content">
                    <InputGroup id="input-a" className="form-width" placeholder="Username"
                                onChange={this.handleUsernameChange}
                                type="text" dir="auto"/>
                    <div className="pt-form-helper-text">Pick a username</div>
                  </div>
                </div>

                <div className="input">
                  <label className="pt-label" for="input-b">
                    Password
                  </label>
                  <div className="pt-form-content">
                    <InputGroup id="input-b" className="form-width" placeholder="Password"
                                onChange={this.handlePasswordChange}
                                type="text" dir="auto"/>
                    <div className="pt-form-helper-text">Pick a password</div>
                  </div>
                </div>

                {/*<div className="input">*/}
                {/*<label className="pt-label" for="input">*/}
                {/*Confirm Password*/}
                {/*</label>*/}
                {/*<div className="pt-form-content">*/}
                {/*<InputGroup id="input" className="pt-input" style={{"width": "300px;"}} placeholder="Username" type="text" dir="auto" />*/}
                {/*<div className="pt-form-helper-text">Confirm your password</div>*/}
                {/*</div>*/}
                {/*</div>*/}

              </div>

              <div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3">{this.props.spinning ? <Spinner className="text-center"/> : <span></span>}</div>
                <div className="col-sm-3"></div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={this.props.closeOverlay}/>
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.submit}
                  text="Create User"
                />
              </div>
            </div>
          </form>
        </Dialog>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isOpen: state.createUser.isOpen,
    spinning: state.createUser.spinning
  };
}

export default withRouter(connect(mapStateToProps, {openOverlay, closeOverlay, createUser})(CreateUser));
