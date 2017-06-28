import React, {Component} from 'react';
import * as Plottable from 'plottable';
import { Tooltip } from '@blueprintjs/core';
import './bar-graph.css';

class BarGraph extends Component {

  constructor(props) {
    super(props);
    this.state = {
      plot: null,
      dataset: null,
      interaction: null,
      tooltipAnchor: null,
      tooltipVisible: false,
      tooltipContent: '',
      firstRender: true
    }
  }

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
    this.props.data.forEach(val => {
      y += val.y;
    })
    return Math.round(y / this.props.data.length); //rounded or keep decimal?
  }

  renderGraph() {
    let min = this.minY();
    let max = this.maxY();
    let scaleMax = max + ((max - min) / 50 + 1);
    let scaleMin = min - ((max - min) / 50 + 1) < 0 ? 0 : min - ((max - min) / 50 + 1);
    const xScale = new Plottable.Scales.Linear().domain([0, 16]);
    const yScale = new Plottable.Scales.Linear().domain([scaleMin, scaleMax]);
    let self = this;


    // TODO: fix this. Do not mutate state directly. Use redux.
    this.state.dataset = new Plottable.Dataset(this.props.data);
    this.state.plot = new Plottable.Plots.Bar()
      .addDataset(this.state.dataset)
      .x(function (d) {
        return d.x;
      }, xScale)
      .y(function (d) {
        return d.y;
      }, yScale)
      //.animator(Plottable.Plots.Animator.MAIN, new Plottable.Animators.Easing().easingMode('quad'))
      .animated(true);

    this.state.interaction = new Plottable.Interactions.Pointer();
    this.state.interaction.onPointerMove(function(p){
      const entity = self.state.plot.entityNearest(p);
      self.state.tooltipAnchor
        .attr('cx',entity.position.x)
        .attr('cy',entity.position.y);
      self.state.tooltipVisible = true;
      self.state.tooltipContent = entity.datum.y;
    });

    this.state.interaction.onPointerExit(function(){
      self.state.tooltipVisible = false;
      self.state.tooltipContent = '';
    });

    this.state.interaction.attachTo(this.state.plot);
    this.state.plot.renderTo("div#bg" + this.props.identifier);

    this.state.tooltipAnchor = this.state.plot
      .foreground()
      .append("circle")
      .attr('r',5)
      .attr('opacity', 1);

    this.state.tooltip =
      <Tooltip
        isOpen={this.state.tooltipVisible}
        content={this.state.tooltipContent}
      >
        this.state.tooltipAnchor.node()
      </Tooltip>;
  }

  componentDidMount() {
    this.renderGraph();
  }

  componentDidUpdate() {
    let min = this.minY();
    let max = this.maxY();
    let scaleMax = max + ((max - min) / 50 + 1);
    let scaleMin = min - ((max - min) / 50 + 1) < 0 ? 0 : min - ((max - min) / 50 + 1);
    const xScale = new Plottable.Scales.Linear().domain([0, 16]);
    const yScale = new Plottable.Scales.Linear().domain([scaleMin, scaleMax]);

    this.state.plot
      .x(function (d) {
        return d.x;
      }, xScale)
      .y(function (d) {
        return d.y;
      }, yScale)
      .animated(this.state.firstRender);
    this.state.dataset
      .data(this.props.data);
    this.state.firstRender = false;
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
                {this.averageY() !== this.averageY() ? "No Blocks" : this.averageY() +
                (this.props.units === undefined ? '' : ' ' + this.props.units)
                }
            </h1>
          </div>
        </div>

      </div>
    );
  }
}

export default BarGraph;
