import React, { Component } from 'react';
import * as Plottable from 'plottable';

class PieChart extends Component {

  constructor(props) {
    super(props);
    this.state = {
      plot: null,
      dataset: null
    }
  }

  componentDidMount() {
    const scale = new Plottable.Scales.Linear();
    const colorScale = new Plottable.Scales.InterpolatedColor();
    colorScale.range(["#FA9B4E", "#5279C7"]);

    this.state.dataset = new Plottable.Dataset(this.props.data);
    this.state.plot = new Plottable.Plots.Pie()
      .addDataset(this.state.dataset)
      .sectorValue(function(d) { return d.val; }, scale)
      .attr("fill", function(d) { return d.val; }, colorScale)
      .renderTo("div#pc");

  }

  componentDidUpdate() {
    const scale = new Plottable.Scales.Linear();
    const colorScale = new Plottable.Scales.InterpolatedColor();
    colorScale.range(["#FA9B4E", "#5279C7"]);


    this.state.plot
      .sectorValue(function(d) { return d.val; }, scale)
      .attr("fill", function(d) { return d.val; }, colorScale);
      
    this.state.dataset.data(this.props.data);
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
