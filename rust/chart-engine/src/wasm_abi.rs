//! Stable C ABI used by the TypeScript WebAssembly host.
use crate::{Bar, BarGeometry, ChartEngine, ChartType, PriceRange, PriceScaleMode};
use std::alloc::{alloc, dealloc, Layout};
use std::{ptr, slice};

#[no_mangle]
pub extern "C" fn chart_engine_new() -> *mut ChartEngine {
    Box::into_raw(Box::new(ChartEngine::new()))
}

#[no_mangle]
pub extern "C" fn chart_engine_free(engine: *mut ChartEngine) {
    if !engine.is_null() {
        // The pointer was returned by chart_engine_new and must be freed once.
        unsafe { drop(Box::from_raw(engine)) };
    }
}

fn allocate_array<T>(len: usize) -> *mut T {
    if len == 0 {
        return ptr::null_mut();
    }
    let Ok(layout) = Layout::array::<T>(len) else {
        return ptr::null_mut();
    };
    // Caller initializes and later frees this allocation with the same length.
    unsafe { alloc(layout).cast::<T>() }
}

fn release_array<T>(array: *mut T, len: usize) {
    if array.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::array::<T>(len) {
        // Pointer and length must come from the matching allocate_array call.
        unsafe { dealloc(array.cast::<u8>(), layout) };
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_alloc_bars(len: usize) -> *mut Bar {
    allocate_array(len)
}

#[no_mangle]
pub extern "C" fn chart_engine_free_bars(bars: *mut Bar, len: usize) {
    release_array(bars, len);
}

#[no_mangle]
pub extern "C" fn chart_engine_alloc_times(len: usize) -> *mut i64 {
    allocate_array(len)
}

#[no_mangle]
pub extern "C" fn chart_engine_free_times(times: *mut i64, len: usize) {
    release_array(times, len);
}

#[no_mangle]
pub extern "C" fn chart_engine_set_history(engine: *mut ChartEngine, bars: *const Bar, len: usize) {
    if engine.is_null() || (len > 0 && bars.is_null()) {
        return;
    }
    let history = if len == 0 {
        &[]
    } else {
        // Caller supplies `len` initialized Bar values in Wasm linear memory.
        unsafe { slice::from_raw_parts(bars, len) }
    };
    // `engine` must be a live, uniquely accessed chart_engine_new handle.
    unsafe { &mut *engine }.set_history(history);
}

#[no_mangle]
pub extern "C" fn chart_engine_push_bar(engine: *mut ChartEngine, bar: *const Bar) {
    if engine.is_null() || bar.is_null() {
        return;
    }
    let bar = unsafe { &*bar };
    // `engine` must be a live, uniquely accessed chart_engine_new handle.
    unsafe { &mut *engine }.push_bar(*bar);
}

#[no_mangle]
pub extern "C" fn chart_engine_push_bars(engine: *mut ChartEngine, bars: *const Bar, len: usize) {
    if engine.is_null() || (len > 0 && bars.is_null()) {
        return;
    }
    let updates = if len == 0 {
        &[]
    } else {
        // Caller supplies `len` initialized Bar values in Wasm linear memory.
        unsafe { slice::from_raw_parts(bars, len) }
    };
    // `engine` must be a live, uniquely accessed chart_engine_new handle.
    unsafe { &mut *engine }.push_bars(updates);
}

#[no_mangle]
pub extern "C" fn chart_engine_truncate_to(engine: *mut ChartEngine, time: i64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.truncate_to(time);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_spacer_times(
    engine: *mut ChartEngine,
    times: *const i64,
    len: usize,
) {
    if engine.is_null() || (len > 0 && times.is_null()) {
        return;
    }
    let spacers = if len == 0 {
        &[]
    } else {
        // Caller supplies `len` initialized i64 values in Wasm linear memory.
        unsafe { slice::from_raw_parts(times, len) }
    };
    unsafe { &mut *engine }.set_spacer_times(spacers);
}

#[no_mangle]
pub extern "C" fn chart_engine_resize(engine: *mut ChartEngine, width: f64, height: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.resize(width, height);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_volume_height(engine: *mut ChartEngine, height: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_volume_height(height);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_bar_spacing(engine: *mut ChartEngine, spacing: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_bar_spacing(spacing);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_right_offset(engine: *mut ChartEngine, offset: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_right_offset(offset);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_chart_type(engine: *mut ChartEngine, chart_type: u32) {
    let chart_type = match chart_type {
        0 => ChartType::Candles,
        1 => ChartType::Line,
        _ => return,
    };
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_chart_type(chart_type);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_scale_mode(engine: *mut ChartEngine, mode: u32) {
    let mode = match mode {
        0 => PriceScaleMode::Normal,
        1 => PriceScaleMode::Logarithmic,
        2 => PriceScaleMode::Percentage,
        _ => return,
    };
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_price_scale_mode(mode);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_inverted(engine: *mut ChartEngine, inverted: u32) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.set_inverted_scale(inverted != 0);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_price_range(
    engine: *mut ChartEngine,
    enabled: u32,
    min: f64,
    max: f64,
) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        let range = (enabled != 0).then_some(PriceRange { min, max });
        engine.set_price_range(range);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_set_visible_range(
    engine: *mut ChartEngine,
    from: f64,
    to: f64,
) -> u32 {
    unsafe { engine.as_mut() }.is_some_and(|engine| engine.set_visible_range(from, to)) as u32
}

#[no_mangle]
pub extern "C" fn chart_engine_pan(engine: *mut ChartEngine, delta_pixels: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.pan(delta_pixels);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_zoom(engine: *mut ChartEngine, factor: f64, anchor_x: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.zoom(factor, anchor_x);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_focus_time(engine: *mut ChartEngine, time: i64) -> u32 {
    unsafe { engine.as_mut() }.is_some_and(|engine| engine.focus_time(time)) as u32
}

#[no_mangle]
pub extern "C" fn chart_engine_select_logical(engine: *mut ChartEngine, logical: f64) {
    if let Some(engine) = unsafe { engine.as_mut() } {
        engine.select_logical(logical);
    }
}

#[no_mangle]
pub extern "C" fn chart_engine_time_to_logical(engine: *const ChartEngine, time: i64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.time_to_logical(time))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_logical_to_time(engine: *const ChartEngine, logical: f64) -> i64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.logical_to_time(logical))
        .unwrap_or(i64::MIN)
}

#[no_mangle]
pub extern "C" fn chart_engine_time_to_x(engine: *const ChartEngine, time: i64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.time_to_x(time))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_x_to_time(engine: *const ChartEngine, x: f64) -> i64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.x_to_time(x))
        .unwrap_or(i64::MIN)
}

#[no_mangle]
pub extern "C" fn chart_engine_logical_to_x(engine: *const ChartEngine, logical: f64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.logical_to_x(logical))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_x_to_logical(engine: *const ChartEngine, x: f64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.x_to_logical(x))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_price_to_y(engine: *const ChartEngine, price: f64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.price_to_y(price))
        .unwrap_or(f64::NAN)
}
#[no_mangle]
pub extern "C" fn chart_engine_price_to_scale_value(engine: *const ChartEngine, price: f64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.price_to_scale_value(price))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_price_to_scale_coordinate(
    engine: *const ChartEngine,
    price: f64,
) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.price_to_scale_coordinate(price))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_scale_coordinate_to_price(
    engine: *const ChartEngine,
    coordinate: f64,
) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.scale_coordinate_to_price(coordinate))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_y_to_price(engine: *const ChartEngine, y: f64) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.y_to_price(y))
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_price_min(engine: *const ChartEngine) -> f64 {
    unsafe { engine.as_ref() }
        .map(|engine| engine.price_range().min)
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_price_max(engine: *const ChartEngine) -> f64 {
    unsafe { engine.as_ref() }
        .map(|engine| engine.price_range().max)
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_visible_from(engine: *const ChartEngine) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.visible_range())
        .map(|range| range.from)
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_visible_to(engine: *const ChartEngine) -> f64 {
    unsafe { engine.as_ref() }
        .and_then(|engine| engine.visible_range())
        .map(|range| range.to)
        .unwrap_or(f64::NAN)
}

#[no_mangle]
pub extern "C" fn chart_engine_bar_count(engine: *const ChartEngine) -> usize {
    unsafe { engine.as_ref() }.map_or(0, |engine| engine.bars().len())
}

/// Rebuilds geometry and returns the number of `BarGeometry` records.
#[no_mangle]
pub extern "C" fn chart_engine_render(engine: *mut ChartEngine) -> usize {
    unsafe { engine.as_mut() }.map_or(0, |engine| engine.render_geometry().len())
}

/// Pointer is valid until the next mutating call on this engine.
#[no_mangle]
pub extern "C" fn chart_engine_geometry_ptr(engine: *const ChartEngine) -> *const BarGeometry {
    unsafe { engine.as_ref() }.map_or(ptr::null(), |engine| engine.geometry_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{align_of, size_of};

    #[test]
    fn exported_layout_and_host_abi_round_trip() {
        assert_eq!(size_of::<Bar>(), 48);
        assert_eq!(align_of::<Bar>(), 8);
        assert_eq!(size_of::<BarGeometry>(), 80);
        assert_eq!(align_of::<BarGeometry>(), 8);

        let engine = chart_engine_new();
        let bars = chart_engine_alloc_bars(2);
        assert!(!engine.is_null());
        assert!(!bars.is_null());
        unsafe {
            ptr::write(
                bars,
                Bar {
                    time: 10,
                    open: 10.0,
                    high: 12.0,
                    low: 9.0,
                    close: 11.0,
                    volume: 50.0,
                },
            );
            ptr::write(
                bars.add(1),
                Bar {
                    time: 20,
                    open: 11.0,
                    high: 13.0,
                    low: 10.0,
                    close: 12.0,
                    volume: 70.0,
                },
            );
        }
        chart_engine_resize(engine, 700.0, 400.0);
        chart_engine_set_history(engine, bars, 2);
        chart_engine_set_right_offset(engine, 0.0);
        assert_eq!(chart_engine_bar_count(engine), 2);
        assert_eq!(chart_engine_render(engine), 2);
        let geometry = chart_engine_geometry_ptr(engine);
        assert!(!geometry.is_null());
        assert_eq!(unsafe { (*geometry).logical }, 0.0);
        assert_eq!(unsafe { (*geometry).candle }, 1.0);
        chart_engine_free_bars(bars, 2);
        chart_engine_free(engine);
    }
    #[test]
    fn null_engine_is_ignored_for_empty_spacers() {
        chart_engine_set_spacer_times(ptr::null_mut(), ptr::null(), 0);
    }
}
