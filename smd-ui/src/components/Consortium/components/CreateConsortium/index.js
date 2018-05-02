import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import ConsortiumDetail from './ConsortiumDetail';
import AddEntity from './AddEntity';
import './createConsortium.css';

class CreateConsortium extends Component {

  constructor() {
    super();
    this.state = { step: 0 }
  }

  handleNextStep = () => {
    this.setState({ step: this.state.step + 1 });
  }

  renderComponent = () => {
    const { step }= this.state;
    switch(step) {
      case 0:
        return <ConsortiumDetail handleNextStep={this.handleNextStep} />
      default:
        return <AddEntity handleNextStep={this.handleNextStep} index={step} canFinish={(step > 2)} />
    }
  }

  render() {
    return (
      <div className="container-fluid pt-dark create-consortium">
        <div className="row">
          <div className="text-left">
            <h3 className="title">Create New Consortium</h3>
            <h4>Create your consortium by filling in the fields below:</h4>
            {(this.state.step > 0) && <h4>This will create a Genesis JSON file to initialize your consortium</h4>}
          </div>
          <div className="pt-card pt-dark pt-elevation-2 col-sm-8">
            {this.renderComponent()}
          </div>
        </div>
      </div>
    )
  }
}

export default withRouter(CreateConsortium);
