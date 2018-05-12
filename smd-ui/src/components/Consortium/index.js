import React, { Component } from "react";
import { Button } from "@blueprintjs/core";
import ConsortiumList from "./components/ConsourtimList";

class Consortium extends Component {

  render() {
    return (
      <div className="container-fluid pt-dark consortium">
        <div className="row">
          <div className="col-md-4 text-left">
            <h3>Consortiums</h3>
          </div>
          <div className="col-md-8 text-right">
            <Button
              text="Create New Consortium"
              className="smd-margin-16 pt-intent-primary pt-icon-add"
              onClick={() => this.props.history.push("/consortium/create")}
            />
          </div>
          <br />
        </div>
        <div className="row">
          <div className="col-md-12">
            <ConsortiumList />
          </div>
        </div>
      </div>
    );
  }
}

export default Consortium;
