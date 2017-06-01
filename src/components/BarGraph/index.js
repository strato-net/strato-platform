import React, { Component } from 'react';
import * as Plottable from 'plottable';
import { Textfit } from 'react-textfit';
import './bar-graph.css';

class BarGraph extends Component {
  componentDidMount() {

    const xScale = new Plottable.Scales.Linear().domain([0,16]);
    const yScale = new Plottable.Scales.Linear().domain([0,this.props.data[this.props.data.length-1].y]);


    // eslint-disable-next-line
    const plot = new Plottable.Plots.Bar()
      .addDataset(new Plottable.Dataset(this.props.data))
      .x(function(d) { return d.x; }, xScale)
      .y(function(d) { return d.y; }, yScale)
      .animated(true)
      .renderTo("div#bg" + this.props.identifier);

  }

  render() {
    return (
      <div className="pt-card pt-dark">
        <div className="row">
          <div className="col-sm-12 text-center">
            <h4>{this.props.label}</h4>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div id={"bg" + this.props.identifier} style={{height: '120px'}}></div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 text-center">
            <h1>
              <Textfit className="text-fit" mode="single" max={36}>
                {this.props.data[this.props.data.length-1].y}
              </Textfit>
            </h1>
          </div>
        </div>

      </div>
    );
  }
}

export default BarGraph;
