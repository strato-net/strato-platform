import React, { Component } from 'react';
import { openCreateChainOverlay, closeCreateChainOverlay, createChain } from './createChain.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import AddMember from './components/AddMember';
import './createChain.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { validate } from './validate';

class CreateChain extends Component {

  constructor(props) {
    super(props);
    this.state = {
      members: [],
      errors: null
    };
    this.updateMembers = this.updateMembers.bind(this);
    this.removeMember = this.removeMember.bind(this);
  }

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
  }

  submit = (values) => {
    values.members = this.state.members;
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
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
        addRule: values.addRule,
        removeRule: values.removeRule
      };
      this.props.createChain(values.chainName, members, balances, values.governanceContract, args);
      this.setState({
        members: [],
      });
    }
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
          <div className="row smd-margin-8 member smd-vertical-center" key={index}>
            <div className="col-sm-1"></div>
            <div className="col-sm-9">
              <span>{member.username}</span>
            </div>
            <div className="col-sm-2">
              <Button
                className="pt-button pt-icon-trash member-remove"
                onClick={() => {
                  this.removeMember(member)
                }}
              />
            </div>
          </div>
        );
      }.bind(this))
      return ret;
    }
    else {
      return (
        <div className="pt-dialog-header no-member">
          <span className="pt-dialog-header-title">No Members</span>
        </div>
      );
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
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
          iconName="flows"
          isOpen={this.props.isOpen}
          onClose={this.props.closeCreateChainOverlay}
          title="Create New Chain"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body create-chain-form">

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Chain Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="chainName"
                    component="input"
                    type="text"
                    placeholder="Chain Name"
                    className="pt-input form-width"
                    tabIndex="1"
                    required
                  />
                  <span className="error-text">{this.errorMessageFor('chainName')}</span>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Governance Contract
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="governanceContract"
                    component="input"
                    type="text"
                    placeholder="Governance Contract"
                    className="pt-input form-width"
                    tabIndex="2"
                    required
                  />
                  <span className="error-text">{this.errorMessageFor('governanceContract')}</span>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Add Rule
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="addRule"
                    >
                      <option />
                      <option value="MajorityRules">Majority Rules</option>
                      <option value="AutoApprove">Auto Approve</option>
                      <option value="TwoIn">Two In</option>
                    </Field>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Remove Rule
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="removeRule"
                    >
                      <option />
                      <option value="MajorityRules">Majority Rules</option>
                      <option value="AutoApprove">Auto Approve</option>
                      <option value="TwoIn">Two In</option>
                    </Field>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="pt-form-group col-sm-12 pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Chain Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <span className="error-text">{this.errorMessageFor('members')}</span>
                  <AddMember handler={this.updateMembers} />
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('create_chain_close_click');
                  this.props.reset();
                  this.setState({
                    members: [],
                  });
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
  return {
    isOpen: state.createChain.isOpen,
  };
}

const formed = reduxForm({ form: 'create-chain' })(CreateChain);
const connected = connect(
  mapStateToProps,
  {
    openCreateChainOverlay,
    closeCreateChainOverlay,
    createChain,
  }
)(formed);

export default withRouter(connected);
