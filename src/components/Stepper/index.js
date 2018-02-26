import React, { Component } from 'react';
import './stepper.css';

class Stepper extends Component {
  render() {
    return (
      <div className="steps-form-2">
        <div className="steps-row-2 setup-panel-2 d-flex justify-content-between">
          <div className={`steps-step-1 ${this.props.step === 0 && 'active'}`}>
            <i className={`fa-2x ${this.props.step > 0 ? "fa fa-check-circle" : "fa fa-user-circle"}`} aria-hidden="true"></i>
          </div>
          <div className={`steps-step-2 ${this.props.step === 1 && 'active'}`}>
            <i className={`fa-2x ${this.props.step > 1 ? "fa fa-check-circle" : "fa fa-credit-card"}`} aria-hidden="true"></i>
          </div>
          <div className={`steps-step-3 third-final ${this.props.step === 2 && 'active'}`}>
            <i className={`fa-2x ${this.props.step > 2 ? "fa fa-check-circle" : "fa fa-code"}`} aria-hidden="true"></i>
          </div>
        </div>
      </div>
    );
  }
}

export default Stepper;
