import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Field, reduxForm, reset, Form } from 'redux-form';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { Button } from '@blueprintjs/core';
import { signPayload, resetError } from './signature.action';
import { toasts } from '../Toasts';

class Signature extends Component {

  componentWillReceiveProps(nextProps) {
    if (nextProps.signedDataError) {
      toasts.show({ message: nextProps.signedDataError });
      this.props.resetError();
    }
  }

  submit = (values) => {
    this.props.signPayload(values);
    this.props.reset();
  };

  render() {
    const { handleSubmit } = this.props;

    return (
      <div className="container-fluid pt-dark external-storage">
        <div className="row">
          <div className="col-sm-12 text-left">
            <h3>Signature</h3>
          </div>
          <div className="col-sm-12">
            <Form onSubmit={handleSubmit(this.submit)}>
              <div className="pt-control-group smd-full-width">
                <div className="smd-input-width">
                  <Field
                    type="text"
                    className="pt-input pt-fill"
                    component="input"
                    name="value"
                    placeholder="Enter your text"
                    onKeyPress={
                      (e) => {
                        if (e.key === 'Enter') {
                          //this.dispatchSubmit();
                          mixpanelWrapper.track('blocks_query_submit');
                        }
                      }
                    }
                    dir="auto" />
                </div>
                <Button type="submit" onClick={() => {
                  mixpanelWrapper.track('blocks_query_submit');
                }}
                  className="pt-intent-primary pt-icon-arrow-right" />
              </div>
            </Form>
            <div>
              {
                this.props.signedPayload &&
                <div>
                  <h3> R: {this.props.signedPayload.r} </h3>
                  <h3> S: {this.props.signedPayload.s} </h3>
                  <h3> V: {this.props.signedPayload.v} </h3>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    signedPayload: state.signedData.signedPayload,
    signedDataError: state.signedData.error,
  };
}

const formed = reduxForm({ form: 'signature' })(Signature);
const connected = connect(mapStateToProps, {
  signPayload,
  resetError
})(formed)

export default withRouter(connected);
