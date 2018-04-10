import React, {Component} from 'react';

import unitMap from '../../lib/constants';
import './ValueInput.css';

class ValueInput extends Component {

  constructor(props) {
    super(props);
    this.state = {
      denomination: 'wei',
      rawValue: 0
    };
    this.handleDenominationChange = this.handleDenominationChange.bind(this);
    this.handleRawValueChange = this.handleRawValueChange.bind(this);

  }

  handleDenominationChange = function(e) {
    this.setState({...this.state, denomination: e.target.value});
    this.props.input.onChange(this.state.rawValue * unitMap[e.target.value]);
  };

  handleRawValueChange = function(e) {
    this.setState({...this.state, rawValue: e.target.value});
    this.props.input.onChange(unitMap[this.state.denomination] * e.target.value);
  };

  render() {
    let { ...props } = this.props;
    const balance = (this.state.denomination === 'wei')
      ? this.props.balance
      : (this.props.balance / unitMap[this.state.denomination]);
    return (
      <div>
        <div className="pt-control-group">
          <div className="pt-select">
            <select
              type="select"
              name="denomination"
              required
              onChange={this.handleDenominationChange}
              value={this.state.denomination}
            >
              {
                Object.keys(unitMap).map(
                  name => <option key={name} value={name}>{name}</option>
                )
              }
            </select>
          </div>

          <div className="pt-fill">
            <input
              id="input-b"
              className="pt-input pt-fill"
              placeholder={props.placeholder || "Value"}
              name={props.name || "value"}
              type="text"
              dir="auto"
              title={props.title || "Value"}
              required
              onChange={this.handleRawValueChange}
              value={this.state.rawValue}
            />
          </div>
        </div>
        {this.props.balance
            ? <div className="balance">Balance: {balance} {this.state.denomination}</div> 
            : null}
      </div>
    );
  }
}

export default ValueInput;
