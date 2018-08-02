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
  }

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_chain_submit_click');
    let members = {};
    members["address"] = values.memAddress;
    members["enode"] = values.memEnode;
    let balances = {};
    balances["address"] = values.address;
    balances["balance"] = values.balance;
    this.props.createChain(values.label, members, balances, values.src, values.args);
  }

  updateMembers(member) {
    const curMembers = this.state.members.slice(0);
    this.setState({
      members: curMembers.concat(member)
    });
  }

  showMembers(members) {
    if (members.length && members.length > 0){
      const ret = [];
      members.forEach(function(member, index){
        ret.push(
          <div>{member}</div>
        )
      })
      return ret;
    }
    else {
      return (<div> No Members </div>);
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
                      tabIndex="6"
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
                      name="args"
                      component="input"
                      type="text"
                      placeholder="Variables"
                      className="pt-input form-width"
                      tabIndex="7"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.args}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Chain Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <AddMember handler={this.updateMembers}/>
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
