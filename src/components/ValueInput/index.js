import React, {Component} from 'react';

import unitMap from '../../lib/constants';

class ValueInput extends Component {

  constructor(props) {
    super(props);
    this.state = {
      denomination: unitMap['wei'],
      rawValue: 0
    };
    this.handleDenominationChange = this.handleDenominationChange.bind(this);
    this.handleRawValueChange = this.handleRawValueChange.bind(this);

  }

  handleDenominationChange = function(e) {
    this.setState({...this.state, denomination: e.target.value});
    this.props.input.onChange(this.state.rawValue * e.target.value);
  };

  handleRawValueChange = function(e) {
    this.setState({...this.state, rawValue: e.target.value});
    this.props.input.onChange(this.state.denomination * e.target.value);
  };

  render() {
    let { ...props } = this.props;
    return (
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
                name => <option key={name} value={unitMap[name]}>{name}</option>
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
    );
  }
}

export default ValueInput;
