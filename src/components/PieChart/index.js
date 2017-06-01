import React, { Component } from 'react';
import * as Plottable from 'plottable';

class PieChart extends Component {
  componentDidMount() {

    const scale = new Plottable.Scales.Linear();
    const colorScale = new Plottable.Scales.InterpolatedColor();
    colorScale.range(["#FA9B4E", "#5279C7"]);
    const data = [{ val: 1 }, { val: 2 }, { val: 3 }];

    // eslint-disable-next-line
    const plot = new Plottable.Plots.Pie()
      .addDataset(new Plottable.Dataset(data))
      .sectorValue(function(d) { return d.val; }, scale)
      .attr("fill", function(d) { return d.val; }, colorScale)
      .renderTo("div#pc");

  }

  render() {
    return (
      <div className="pt-card pt-dark">
        <div className="row">
          <div className="col-sm-12 text-center">
            <h4>Transaction Type</h4>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div id="pc" style={{height: '189px'}}></div>
          </div>
        </div>
      </div>
    );
  }
}

export default PieChart;
