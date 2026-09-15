// The chart kit, gathered in one import. Each chart lives in components/charts/.
import AreaChartBase from './charts/AreaChart';
import SparklineBase from './charts/Sparkline';

export { default as ColumnChart } from './charts/ColumnChart';
export { default as HorizontalBars } from './charts/HorizontalBars';
export { default as ShareBar, seriesColor, OTHER_COLOR } from './charts/ShareBar';
export { default as Heatmap } from './charts/Heatmap';
export { default as Rings, RingsLegend } from './charts/Rings';
export { default as Meter } from './charts/Meter';
export { default as StatTile } from './charts/StatTile';

/** Accepts the older `series` prop name as well as `data`. */
export function AreaChart({ series, data, ...props }) {
  return <AreaChartBase data={data ?? series ?? []} {...props} />;
}

/** Accepts the older `tone` prop name as well as `color`. */
export function Sparkline({ tone, color, ...props }) {
  return <SparklineBase color={color ?? tone} {...props} />;
}
