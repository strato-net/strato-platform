import React, {Component} from 'react';
import * as Plottable from 'plottable';
import './bar-graph.css';

class BarGraph extends Component {

  constructor(props) {
    super(props);
    this.state = {
      plot: null,
      dataset: null,
      interaction: null,
      tooltipAnchor: null,
      tooltipText: null,
      tooltipBox: null,
      tooltip: null,
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
    // eslint-disable-next-line
    this.state.dataset = new Plottable.Dataset(this.props.data);
    // eslint-disable-next-line
    this.state.plot = new Plottable.Plots.Bar()
      .addDataset(this.state.dataset)
      .x(function (d) {
        return d.x;
      }, xScale)
      .y(function (d) {
        return d.y;
      }, yScale)
      //.animator(Plottable.Plots.Animator.MAIN, new Plottable.Animators.Easing().easingMode('quad'))
      .animated(true)
      .attr('fill', '#00AEEF')
      ;

    // eslint-disable-next-line
    this.state.interaction = new Plottable.Interactions.Pointer();
    this.state.interaction.onPointerMove(function(p){
      const entity = self.state.plot.entityNearest(p);
      if(entity) {
        self.state.tooltipText
          .text(entity.datum.y);
        const bbox = self.state.tooltipText.node().getBBox();
        self.state.tooltipBox
          .attr('x',bbox.x-8)
          .attr('y',bbox.y-3)
          .attr('width',bbox.width+16)
          .attr('height',bbox.height+6);
        self.state.tooltip
          .attr('points', [
            0,
            -20,
            -5,
            -15,
            5,
            -15
          ].join(','));

        self.state.tooltipAnchor
          .attr('transform','translate(' + entity.position.x + ',' + (entity.position.y+20)  + ')')
          .attr('opacity',1);
      }
    });

    this.state.interaction.onPointerExit(function(){
      self.state.tooltipAnchor
        .attr('opacity',0);
    });

    this.state.interaction.attachTo(this.state.plot);
    this.state.plot.renderTo("div#bg" + this.props.identifier);

    // eslint-disable-next-line
    this.state.tooltipAnchor = this.state.plot
      .foreground()
      .style('overflow','visible')
      .append('g')
      .attr('opacity', 0);

    // eslint-disable-next-line
    this.state.tooltipBox = this.state.tooltipAnchor
      .append('rect')
      .style('fill','#293742')
      .attr('rx', 4)
      .attr('ry', 4);

    // eslint-disable-next-line
    this.state.tooltip = this.state.tooltipAnchor
      .append('polygon')
      .style('fill','#293742');

    // eslint-disable-next-line
    this.state.tooltipText = this.state.tooltipAnchor
      .append("text")
      .style('fill','#f5f8fa')
      .attr('text-anchor','middle')
      .text('test');

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
    // eslint-disable-next-line
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
            <h2>Avg: {' '}
                {this.averageY() !== this.averageY() ? "No Blocks" : this.averageY() +
                (this.props.units === undefined ? '' : ' ' + this.props.units)
                }
            </h2>
          </div>
        </div>

      </div>
    );
  }
}

export default BarGraph;
