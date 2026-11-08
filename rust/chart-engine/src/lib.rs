//! Deterministic, host-testable market chart state and primitive geometry.
mod wasm_abi;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bar {
    /// Timestamp in caller-defined integer time units.
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChartType {
    Candles,
    Line,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PriceScaleMode {
    Normal,
    Logarithmic,
    Percentage,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LogicalRange {
    pub from: f64,
    pub to: f64,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PriceRange {
    pub min: f64,
    pub max: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BarGeometry {
    pub logical: f64,
    pub x: f64,
    pub open_y: f64,
    pub high_y: f64,
    pub low_y: f64,
    pub close_y: f64,
    pub volume_top: f64,
    pub volume_bottom: f64,
    pub up: f64,
    pub candle: f64,
}

const PRICE_TOP_MARGIN: f64 = 0.08;
const PRICE_BOTTOM_MARGIN: f64 = 0.06;
/// Stateful chart model. Coordinates and dimensions are media pixels; logical
/// indices address bars followed by spacer slots. Times use Bar::time units.
pub struct ChartEngine {
    bars: Vec<Bar>,
    spacers: Vec<i64>,
    geometry: Vec<BarGeometry>,
    width: f64,
    height: f64,
    volume_height: f64,
    spacing: f64,
    right_offset: f64,
    range: LogicalRange,
    following_latest: bool,
    follow_gap: f64,
    chart_type: ChartType,
    mode: PriceScaleMode,
    inverted: bool,
    manual: Option<PriceRange>,
    auto: PriceRange,
}

impl Default for ChartEngine {
    fn default() -> Self {
        Self::new()
    }
}
impl ChartEngine {
    pub fn new() -> Self {
        Self {
            bars: Vec::with_capacity(6000),
            spacers: Vec::new(),
            geometry: Vec::with_capacity(6000),
            width: 0.0,
            height: 0.0,
            volume_height: 120.0,
            spacing: 7.0,
            right_offset: 12.0,
            range: LogicalRange {
                from: -12.0,
                to: 0.0,
            },
            following_latest: true,
            follow_gap: 12.0,
            chart_type: ChartType::Candles,
            mode: PriceScaleMode::Normal,
            inverted: false,
            manual: None,
            auto: PriceRange { min: 0.0, max: 1.0 },
        }
    }
    pub fn bars(&self) -> &[Bar] {
        &self.bars
    }
    pub fn set_history(&mut self, bars: &[Bar]) {
        self.bars.clear();
        self.bars
            .extend(bars.iter().filter(|bar| valid_bar(bar)).copied());
        self.bars.sort_unstable_by_key(|bar| bar.time);
        let excess = self.bars.len().saturating_sub(6000);
        if excess > 0 {
            self.bars.drain(..excess);
        }
        if let Some(last_bar_time) = self.bars.last().map(|bar| bar.time) {
            self.spacers.retain(|time| *time > last_bar_time);
        }
        self.recompute_range();
        self.update_auto();
    }
    pub fn push_bar(&mut self, bar: Bar) {
        if self.insert_bar(bar) {
            self.update_auto();
        }
    }
    pub fn push_bars(&mut self, bars: &[Bar]) {
        let mut changed = false;
        for bar in bars {
            changed |= self.insert_bar(*bar);
        }
        if changed {
            self.update_auto();
        }
    }
    pub fn truncate_to(&mut self, timestamp: i64) {
        let count = self.bars.partition_point(|bar| bar.time <= timestamp);
        self.bars.truncate(count);
        if let Some(last_bar_time) = self.bars.last().map(|bar| bar.time) {
            self.spacers.retain(|time| *time > last_bar_time);
        }
        self.recompute_range();
        self.update_auto();
    }
    pub fn set_spacer_times(&mut self, times: &[i64]) {
        let following_latest = self.following_latest;
        self.spacers.clear();
        self.spacers.extend_from_slice(times);
        self.spacers.sort_unstable();
        self.spacers.dedup();
        if let Some(last_bar_time) = self.bars.last().map(|bar| bar.time) {
            self.spacers.retain(|time| *time > last_bar_time);
        }
        if following_latest {
            self.update_auto();
        }
    }
    pub fn resize(&mut self, width: f64, height: f64) {
        if !width.is_finite() || !height.is_finite() || width < 0.0 || height < 0.0 {
            return;
        }
        let right = self.range.to;
        self.width = width;
        self.height = height;
        let span = if self.width > 0.0 {
            (self.width / self.spacing).max(4.0)
        } else {
            self.span()
        };
        self.range = LogicalRange {
            from: right - span,
            to: right,
        };
        self.update_auto();
    }
    pub fn set_bar_spacing(&mut self, spacing: f64) {
        if !spacing.is_finite() || spacing <= 0.0 {
            return;
        }
        let right = self.range.to;
        self.spacing = spacing.clamp(1.0, 100.0);
        let span = if self.width > 0.0 {
            (self.width / self.spacing).max(4.0)
        } else {
            self.span()
        };
        self.range = LogicalRange {
            from: right - span,
            to: right,
        };
        self.update_auto();
    }
    pub fn bar_spacing(&self) -> f64 {
        self.spacing
    }
    pub fn set_right_offset(&mut self, offset: f64) {
        if offset.is_finite() {
            self.right_offset = offset;
            if self.following_latest {
                self.follow_gap = offset;
                self.recompute_following_range();
                self.update_auto();
            }
        }
    }
    pub fn set_volume_height(&mut self, height: f64) {
        if height.is_finite() && height >= 0.0 {
            self.volume_height = height;
        }
    }
    pub fn set_chart_type(&mut self, chart_type: ChartType) {
        self.chart_type = chart_type;
    }
    pub fn set_price_scale_mode(&mut self, mode: PriceScaleMode) {
        self.mode = mode;
    }
    pub fn set_inverted_scale(&mut self, inverted: bool) {
        self.inverted = inverted;
    }
    pub fn price_scale_mode(&self) -> PriceScaleMode {
        self.mode
    }
    pub fn set_price_range(&mut self, range: Option<PriceRange>) {
        self.manual = range.filter(|r| r.min.is_finite() && r.max.is_finite() && r.max > r.min);
    }
    pub fn price_range(&self) -> PriceRange {
        self.manual.unwrap_or(self.auto)
    }
    pub fn visible_range(&self) -> Option<LogicalRange> {
        if self.bars.is_empty() || self.width <= 0.0 || self.height <= 0.0 {
            None
        } else {
            Some(self.range)
        }
    }
    pub fn set_visible_range(&mut self, from: f64, to: f64) -> bool {
        let span = to - from;
        if !from.is_finite() || !to.is_finite() || !span.is_finite() || span <= 0.0 {
            return false;
        }
        let spacing = if self.width > 0.0 {
            self.width / span
        } else {
            self.spacing
        };
        if !spacing.is_finite() || spacing <= 0.0 {
            return false;
        }
        self.range = LogicalRange { from, to };
        self.spacing = spacing;
        self.update_follow_state();
        self.update_auto();
        true
    }
    pub fn pan(&mut self, delta_pixels: f64) {
        if !delta_pixels.is_finite() || delta_pixels == 0.0 || self.width <= 0.0 {
            return;
        }
        let delta = delta_pixels / self.spacing;
        let from = self.range.from - delta;
        let to = self.range.to - delta;
        if !from.is_finite() || !to.is_finite() {
            return;
        }
        self.range = LogicalRange { from, to };
        self.update_follow_state();
        self.update_auto();
    }
    pub fn zoom(&mut self, factor: f64, anchor_x: f64) {
        if !factor.is_finite() || factor <= 0.0 || !anchor_x.is_finite() || self.width <= 0.0 {
            return;
        }
        let anchor = self.range.from + anchor_x.clamp(0.0, self.width) / self.spacing;
        let span = self.span();
        if !anchor.is_finite() || !span.is_finite() || span <= 0.0 {
            return;
        }
        let ratio = ((anchor - self.range.from) / span).clamp(0.0, 1.0);
        let new_span = (span * factor).max(4.0);
        if !ratio.is_finite() || !new_span.is_finite() {
            return;
        }
        let from = anchor - ratio * new_span;
        let to = anchor + (1.0 - ratio) * new_span;
        let spacing = self.width / new_span;
        if !from.is_finite() || !to.is_finite() || !spacing.is_finite() || spacing <= 0.0 {
            return;
        }
        self.range = LogicalRange { from, to };
        self.spacing = spacing;
        self.update_follow_state();
        self.update_auto();
    }
    pub fn focus_time(&mut self, time: i64) -> bool {
        let Some(logical) = self.time_to_logical(time) else {
            return false;
        };
        let span = self.span();
        self.range = LogicalRange {
            from: logical - span * 0.72,
            to: logical + span * 0.28,
        };
        self.update_follow_state();
        self.update_auto();
        true
    }
    pub fn select_logical(&mut self, logical: f64) {
        if !logical.is_finite() {
            return;
        }
        let span = self.span();
        self.range = LogicalRange {
            from: logical - span / 2.0,
            to: logical + span / 2.0,
        };
        self.update_follow_state();
        self.update_auto();
    }
    pub fn time_to_logical(&self, time: i64) -> Option<f64> {
        self.bars
            .binary_search_by_key(&time, |bar| bar.time)
            .ok()
            .or_else(|| {
                self.spacers
                    .binary_search(&time)
                    .ok()
                    .map(|index| self.bars.len() + index)
            })
            .map(|index| index as f64)
    }
    pub fn logical_to_time(&self, logical: f64) -> Option<i64> {
        if !logical.is_finite() || logical < 0.0 {
            return None;
        }
        let index = logical.round() as usize;
        self.bars.get(index).map(|bar| bar.time).or_else(|| {
            self.spacers
                .get(index.saturating_sub(self.bars.len()))
                .copied()
        })
    }
    pub fn logical_to_x(&self, logical: f64) -> Option<f64> {
        logical
            .is_finite()
            .then_some((logical - self.range.from) * self.spacing)
    }
    pub fn x_to_logical(&self, x: f64) -> Option<f64> {
        (x.is_finite() && self.spacing > 0.0).then_some(self.range.from + x / self.spacing)
    }
    pub fn time_to_x(&self, time: i64) -> Option<f64> {
        self.logical_to_x(self.time_to_logical(time)?)
    }
    pub fn x_to_time(&self, x: f64) -> Option<i64> {
        self.logical_to_time(self.x_to_logical(x)?)
    }
    pub fn price_to_y(&self, price: f64) -> Option<f64> {
        if !price.is_finite() || self.height <= 0.0 {
            return None;
        }
        let range = self.price_range();
        let (price, min, max) = self.transformed(price, range.min, range.max)?;
        let fraction = (price - min) / (max - min);
        let plot_fraction = 1.0 - PRICE_TOP_MARGIN - PRICE_BOTTOM_MARGIN;
        let y_fraction = if self.inverted {
            PRICE_TOP_MARGIN + fraction * plot_fraction
        } else {
            PRICE_TOP_MARGIN + (1.0 - fraction) * plot_fraction
        };
        Some(self.height * y_fraction)
    }
    pub fn y_to_price(&self, y: f64) -> Option<f64> {
        if !y.is_finite() || self.height <= 0.0 {
            return None;
        }
        let range = self.price_range();
        let (min, max) = self.bounds_transformed(range.min, range.max)?;
        let plot_fraction = 1.0 - PRICE_TOP_MARGIN - PRICE_BOTTOM_MARGIN;
        let y_fraction = (y / self.height - PRICE_TOP_MARGIN) / plot_fraction;
        let fraction = if self.inverted {
            y_fraction
        } else {
            1.0 - y_fraction
        };
        let transformed = min + fraction * (max - min);
        let value = match self.mode {
            PriceScaleMode::Logarithmic => from_log_scale(transformed),
            PriceScaleMode::Percentage => from_percent_scale(transformed, self.percentage_base()?),
            PriceScaleMode::Normal => transformed,
        };
        value.is_finite().then_some(value)
    }
    pub fn price_to_scale_value(&self, price: f64) -> Option<f64> {
        if !price.is_finite() {
            return None;
        }
        match self.mode {
            PriceScaleMode::Percentage => Some(to_percent_scale(price, self.percentage_base()?)),
            PriceScaleMode::Normal | PriceScaleMode::Logarithmic => Some(price),
        }
    }
    /// Converts a raw price to the active, non-inverted scale space.
    pub fn price_to_scale_coordinate(&self, price: f64) -> Option<f64> {
        if !price.is_finite() {
            return None;
        }
        let value = match self.mode {
            PriceScaleMode::Normal => price,
            PriceScaleMode::Logarithmic => to_log_scale(price),
            PriceScaleMode::Percentage => {
                to_percent_scale(price, self.percentage_base().unwrap_or(0.0))
            }
        };
        value.is_finite().then_some(value)
    }
    /// Converts a non-inverted scale-space value back to a raw price.
    pub fn scale_coordinate_to_price(&self, coordinate: f64) -> Option<f64> {
        if !coordinate.is_finite() {
            return None;
        }
        let price = match self.mode {
            PriceScaleMode::Normal => coordinate,
            PriceScaleMode::Logarithmic => from_log_scale(coordinate),
            PriceScaleMode::Percentage => {
                from_percent_scale(coordinate, self.percentage_base().unwrap_or(0.0))
            }
        };
        price.is_finite().then_some(price)
    }
    pub fn render_geometry(&mut self) -> &[BarGeometry] {
        self.geometry.clear();
        if self.bars.is_empty() || self.width <= 0.0 || self.height <= 0.0 {
            return &self.geometry;
        }
        let len = self.bars.len();
        let start = self.range.from.floor().max(0.0).min(len as f64) as usize;
        let end = (self.range.to.floor() + 1.0).max(0.0).min(len as f64) as usize;
        if start >= end {
            return &self.geometry;
        }
        let max_volume = self.bars[start..end]
            .iter()
            .map(|bar| bar.volume)
            .fold(0.0_f64, f64::max);
        self.geometry.reserve(end - start);
        for index in start..end {
            let bar = self.bars[index];
            let (Some(open_y), Some(high_y), Some(low_y), Some(close_y)) = (
                self.price_to_y(bar.open),
                self.price_to_y(bar.high),
                self.price_to_y(bar.low),
                self.price_to_y(bar.close),
            ) else {
                continue;
            };
            let volume_top = if max_volume > 0.0 {
                self.volume_height - bar.volume / max_volume * self.volume_height
            } else {
                self.volume_height
            };
            self.geometry.push(BarGeometry {
                logical: index as f64,
                x: (index as f64 - self.range.from) * self.spacing,
                open_y,
                high_y,
                low_y,
                close_y,
                volume_top,
                volume_bottom: self.volume_height,
                up: if bar.close >= bar.open { 1.0 } else { 0.0 },
                candle: if self.chart_type == ChartType::Candles {
                    1.0
                } else {
                    0.0
                },
            });
        }
        &self.geometry
    }
    pub fn geometry_ptr(&self) -> *const BarGeometry {
        self.geometry.as_ptr()
    }
    fn span(&self) -> f64 {
        let span = self.range.to - self.range.from;
        if span.is_finite() && span > 0.0 {
            span
        } else if self.width > 0.0 {
            (self.width / self.spacing).max(4.0)
        } else {
            12.0
        }
    }
    fn last_logical(&self) -> f64 {
        self.bars
            .len()
            .saturating_add(self.spacers.len())
            .saturating_sub(1) as f64
    }
    fn latest_data_logical(&self) -> f64 {
        match self.bars.len().checked_sub(1) {
            Some(index) => index as f64,
            None => self.last_logical(),
        }
    }
    fn recompute_range(&mut self) {
        self.following_latest = true;
        self.follow_gap = self.right_offset;
        self.recompute_following_range();
    }
    fn recompute_following_range(&mut self) {
        let span = self.span();
        self.range.to = self.latest_data_logical() + self.follow_gap;
        self.range.from = self.range.to - span;
    }
    fn update_follow_state(&mut self) {
        let gap = self.range.to - self.latest_data_logical();
        let minimum = self.right_offset.min(0.0) - 0.5;
        let maximum = self.right_offset.max(0.0) + 0.5;
        self.following_latest = self.bars.is_empty() || (gap >= minimum && gap <= maximum);
        if self.following_latest {
            self.follow_gap = gap;
        }
    }
    fn insert_bar(&mut self, bar: Bar) -> bool {
        if !valid_bar(&bar) {
            return false;
        }
        let following_latest = self.following_latest;
        let follow_gap = self.follow_gap;
        match self
            .bars
            .binary_search_by_key(&bar.time, |existing| existing.time)
        {
            Ok(index) => self.bars[index] = bar,
            Err(index) if index == self.bars.len() => {
                self.bars.push(bar);
                if self.bars.len() > 6000 {
                    self.bars.remove(0);
                    if !following_latest {
                        self.range.from -= 1.0;
                        self.range.to -= 1.0;
                    }
                }
                if following_latest {
                    self.follow_gap = follow_gap;
                    self.recompute_following_range();
                }
            }
            Err(index) => {
                let before_visible = index as f64 <= self.range.from;
                self.bars.insert(index, bar);
                if self.bars.len() > 6000 {
                    self.bars.remove(0);
                } else if following_latest {
                    self.follow_gap = follow_gap;
                    self.recompute_following_range();
                } else if before_visible {
                    self.range.from += 1.0;
                    self.range.to += 1.0;
                }
            }
        }
        if let Some(last_bar_time) = self.bars.last().map(|bar| bar.time) {
            self.spacers.retain(|time| *time > last_bar_time);
        }
        true
    }
    fn update_auto(&mut self) {
        let len = self.bars.len();
        if len == 0 {
            self.auto = PriceRange { min: 0.0, max: 1.0 };
            return;
        }
        let start = self.range.from.floor().max(0.0).min(len as f64) as usize;
        let end = (self.range.to.floor() + 1.0).max(0.0).min(len as f64) as usize;
        let visible = if start < end {
            &self.bars[start..end]
        } else {
            &self.bars[..]
        };
        let first = visible[0];
        let mut min = first.low;
        let mut max = first.high;
        for bar in visible {
            min = min.min(bar.low);
            max = max.max(bar.high);
        }
        if max > min {
            self.auto = PriceRange { min, max };
        } else {
            self.auto = PriceRange {
                min: min - 0.5,
                max: max + 0.5,
            };
        }
    }
    fn percentage_base(&self) -> Option<f64> {
        let len = self.bars.len();
        if len == 0 {
            return None;
        }
        let index = self.range.from.floor().max(0.0).min((len - 1) as f64) as usize;
        Some(self.bars[index].close)
    }
    fn bounds_transformed(&self, lo: f64, hi: f64) -> Option<(f64, f64)> {
        let (first, second) = match self.mode {
            PriceScaleMode::Normal => (lo, hi),
            PriceScaleMode::Logarithmic => (to_log_scale(lo), to_log_scale(hi)),
            PriceScaleMode::Percentage => {
                let base = self.percentage_base()?;
                (to_percent_scale(lo, base), to_percent_scale(hi, base))
            }
        };
        Some((first.min(second), first.max(second)))
    }
    fn transformed(&self, price: f64, lo: f64, hi: f64) -> Option<(f64, f64, f64)> {
        let (min, max) = self.bounds_transformed(lo, hi)?;
        let value = match self.mode {
            PriceScaleMode::Normal => price,
            PriceScaleMode::Logarithmic => to_log_scale(price),
            PriceScaleMode::Percentage => to_percent_scale(price, self.percentage_base()?),
        };
        Some((value, min, max))
    }
}
fn to_log_scale(price: f64) -> f64 {
    if price.abs() <= 1e-15 {
        return 0.0;
    }
    price.signum() * (price.abs() + 0.0001).log10() + price.signum() * 4.0
}
fn from_log_scale(value: f64) -> f64 {
    value.signum() * (10.0_f64.powf(value.abs() - 4.0) - 0.0001)
}
fn to_percent_scale(value: f64, base: f64) -> f64 {
    if base == 0.0 {
        return value;
    }
    let percentage = 100.0 * (value - base) / base;
    if base < 0.0 {
        -percentage
    } else {
        percentage
    }
}
fn from_percent_scale(value: f64, base: f64) -> f64 {
    if base == 0.0 {
        return value;
    }
    let percentage = if base < 0.0 { -value } else { value };
    (percentage / 100.0) * base + base
}
fn valid_bar(bar: &Bar) -> bool {
    bar.open.is_finite()
        && bar.high.is_finite()
        && bar.low.is_finite()
        && bar.close.is_finite()
        && bar.volume.is_finite()
        && bar.volume >= 0.0
        && bar.high >= bar.low
        && bar.high >= bar.open.max(bar.close)
        && bar.low <= bar.open.min(bar.close)
}

#[cfg(test)]
mod tests;
