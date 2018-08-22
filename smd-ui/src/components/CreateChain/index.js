import React, { Component } from 'react';
import { openCreateChainOverlay, closeCreateChainOverlay, createChain } from './createChain.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import AddMember from './components/AddMember';
import './createChain.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CreateChain extends Component {

  constructor(props) {
    super(props);
    this.state = {
      members: [],
    };
    this.updateMembers = this.updateMembers.bind(this);
    this.removeMember = this.removeMember.bind(this);
  }

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_chain_submit_click');
    let members = [];
    let balances = [];
    this.state.members.forEach(function (member, index) {
      members.push({
        "address": member.address,
        "enode": member.enode
      });
      balances.push({
        "balance": member.balance,
        "address": member.address
      });
    });
    let args = {
      [values.var1]: values.val1,
      [values.var2]: values.val2
    };
    this.props.createChain(values.label, members, balances, values.src, args);
    this.setState({
      members: [],
    });
  }

  updateMembers(state) {
    const curMembers = this.state.members.slice(0);
    const usernames = [];
    curMembers.forEach(function (member, index) {
      usernames.push(member.username);
    });
    if (!usernames.includes(state.username)) {
      this.setState({
        members: curMembers.concat({
          username: state.username,
          address: state.address,
          enode: state.enode,
          balance: parseInt(state.balance, 10)
        })
      });
    }
  }

  removeMember(member) {
    const members = this.state.members.slice(0);
    const index = members.indexOf(member);
    members.splice(index, 1);
    this.setState({
      members: members
    });
  }

  showMembers(members) {
    if (members.length && members.length > 0) {
      const ret = [];
      members.forEach(function (member, index) {
        ret.push(
          <div className="pt-dialog-header" key={index}>
            <span className="pt-dialog-header-title">{member.username}</span>
            <Button
              className="pt-button pt-icon-small-cross"
              onClick={() => {
                this.removeMember(member)
              }}
              text='Remove' />
          </div>
        );
      }.bind(this))
      return ret;
    }
    else {
      return (
        <div className="pt-dialog-header">
          <span className="pt-dialog-header-title">No Members</span>
        </div>
      );
    }
  }

  render() {
    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track('create_chain_open_click');
          this.props.reset();
          this.props.openCreateChainOverlay();
        }} className="pt-intent-primary pt-icon-add"
          id="chains-create-chain-button"
          text="Create Chain" />

        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeCreateChainOverlay}
          title="Create New Chain"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body">
              <div className="pt-form-group">
                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-a">
                    Chain Label
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="label"
                      component="input"
                      type="text"
                      placeholder="Chain Label"
                      className="pt-input form-width"
                      tabIndex="1"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.label}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-d">
                    Governance Contract
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="src"
                      component="input"
                      type="text"
                      placeholder="Governance Contract"
                      className="pt-input form-width"
                      tabIndex="2"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.src}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-e">
                    Arguments
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="var1"
                      component="input"
                      type="text"
                      placeholder="Variable Name"
                      className="pt-input form-width"
                      tabIndex="3"
                      required
                    />

                    <Field
                      name="val1"
                      component="input"
                      type="text"
                      placeholder="Variable Value"
                      className="pt-input form-width"
                      tabIndex="4"
                      required
                    />
                  </div>
                  <div className="pt-form-content">
                    <Field
                      name="var2"
                      component="input"
                      type="text"
                      placeholder="Variable Name"
                      className="pt-input form-width"
                      tabIndex="5"
                      required
                    />

                    <Field
                      name="val2"
                      component="input"
                      type="text"
                      placeholder="Variable Value"
                      className="pt-input form-width"
                      tabIndex="6"
                      required
                    />
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Chain Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <AddMember handler={this.updateMembers} />
                </div>
              </div>

              <div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('create_chain_close_click');
                  this.props.reset();
                  this.props.closeCreateChainOverlay();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create Chain"
                />
              </div>
            </div>
          </form>
        </Dialog>

      </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };
  if (state.form && state.form["create-chain"]) {
    errors = { errors: state.form["create-chain"].syncErrors }
  }
  return {
    isOpen: state.createChain.isOpen,
    ...errors
  };
}

export function validate(values) {
  //TODO: add validations for chain creation
  const errors = {};
  return errors;
}

const formed = reduxForm({ form: 'create-chain', validate })(CreateChain);
const connected = connect(
  mapStateToProps,
  {
    openCreateChainOverlay,
    closeCreateChainOverlay,
    createChain,
  }
)(formed);

export default withRouter(connected);
