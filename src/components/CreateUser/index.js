import React, {Component} from 'react';
import {openOverlay, closeOverlay} from './createUser.actions';
import {Button, Dialog, Intent} from '@blueprintjs/core';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

class CreateUser extends Component {

  render() {
    return (<div>
      <Button onClick={this.props.openOverlay} text="Create User" />
      <Dialog
        iconName="inbox"
        isOpen={this.props.isOpen}
        onClose={this.props.closeOverlay}
        title="Create New User"
        className=""
      >
        {/*FIXME Text input divs are not positioned sensibly */}
        <div className="pt-dialog-body">
            <form className="container-fluid">
              <div className="row">
                <label class="pt-label row">
                  <div className="col-sm-6">Create a Username</div>
                  <div className="col-sm-6 text-right">
                    <input class="pt-input" type="text" placeholder="Create Username" dir="auto" />
                  </div>
                </label>
              </div>

              <div className="row">
                <label class="pt-label row">
                  <div className="col-sm-6">Create a Password</div>
                  <div className="col-sm-6 text-right">
                    <input class="pt-input" type="text" placeholder="Create Password" dir="auto" />
                  </div>
                </label>
              </div>

              <div className="row">
              <label class="pt-label">
                <div className="col-sm-6">Confirm Your Password</div>
                <div className="col-sm-6 text-right">
                  <input class="pt-input" type="text" placeholder="Confirm Password" dir="auto" />
                </div>
              </label>
              </div>
            </form>
        </div>
        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions">
            <Button text="Cancel" onClick={this.props.closeOverlay}/>
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.closeOverlay}
              text="Create"
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
    isOpen: state.createUser.isOpen
  };
}

export default withRouter(connect(mapStateToProps, {openOverlay, closeOverlay})(CreateUser));
