import React, {Component} from 'react';
import * as Plottable from 'plottable';
import {Textfit} from 'react-textfit';
import './bar-graph.css';

class BarGraph extends Component {

  maxY() {
    var max = 0;
    var y = 0;
    for (; y < this.props.data.length; y++) {
      max = Math.max(this.props.data[y].y, max);
    }
    return max;
  }

  minY() {
    var min = 0;
    var y = 0;
    for (; y < this.props.data.length; y++) {
      min = Math.min(this.props.data[y].y, min);
    }
    return min;
  }

  averageY() {
    var y = 0;
    this.props.data.map(val => {
      y += val.y;
    })
    return Math.round(y / this.props.data.length); //rounded or keep decimal?
  }

  componentDidMount() {
    let min = this.minY();
    let max = this.maxY();
    let scaleMax = max + ((max - min) / 50 + 1);
    let scaleMin = min - ((max - min) / 50 + 1) < 0 ? 0 : min - ((max - min) / 50 + 1);
    const xScale = new Plottable.Scales.Linear().domain([0, 16]);
    const yScale = new Plottable.Scales.Linear().domain([scaleMin, scaleMax]);

    // eslint-disable-next-line
    const plot = new Plottable.Plots.Bar()
      .addDataset(new Plottable.Dataset(this.props.data))
      .x(function (d) {
        return d.x;
      }, xScale)
      .y(function (d) {
        return d.y;
      }, yScale)
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
                {(this.props.number === undefined ? this.averageY() : this.props.number) +
                (this.props.units === undefined ? '' : ' ' + this.props.units)
                }
              </Textfit>
            </h1>
          </div>
        </div>

      </div>
    );
  }
}

export default BarGraph;
