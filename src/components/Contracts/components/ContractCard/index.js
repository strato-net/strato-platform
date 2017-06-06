import React, {Component} from 'react';
import {Button, Collapse} from '@blueprintjs/core';
class ContractCard extends Component {
  constructor(props) {
    super(props);
    this.state = {isOpen: false};
  }

  render() {
    return (
      <div className="row smd-pad-16">
        <div className="pt-card pt-dark pt-elevation-2 col-md-6">
          <div className="col-sm-6"><h3>{this.props.value.name}</h3></div>
          <div className="col-sm-3 smd-pad-16 right"><Button type="button" className="pt-intent-primary">Query
            Contract</Button></div>
          <div className="col-sm-3 smd-pad-16 right"><Button type="button"
                                                             className={"pt-dark pt-intent-primary"}
                                                             onClick={() => {
                                                               this.setState({isOpen: !this.state.isOpen})
                                                             }}>
            {this.state.isOpen ? "Hide" : "Show"} Contracts
          </Button></div>
          <Collapse isOpen={this.state.isOpen} component="table" className="col-sm-12" transitionDuration={0}>
            <table className="pt-table pt-interactive pt-condensed pt-striped">
              <thead>
              <th className="col-sm-3"><h4>Contract Address</h4></th>
              <th className="col-sm-3"><h4>Created At</h4></th>
              </thead>
              <tbody>{this.props.value.rows}</tbody>
            </table>
          </Collapse>
        </div>

        <div className="col-md-6">
          <div className="pt-card pt-dark pt-elevation-2">
          </div>
        </div>
      </div>
    );
  }
}

export default ContractCard;