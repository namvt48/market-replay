use super::*;
fn bar(time: i64, close: f64) -> Bar {
    Bar {
        time,
        open: close - 1.0,
        high: close + 1.0,
        low: close - 2.0,
        close,
        volume: 10.0,
    }
}
fn populated() -> ChartEngine {
    let mut c = ChartEngine::new();
    c.resize(700.0, 400.0);
    c.set_history(&[bar(1, 10.0), bar(2, 12.0), bar(3, 11.0)]);
    c
}
#[test]
fn append_and_equal_time_replace() {
    let mut c = populated();
    c.push_bar(bar(3, 14.0));
    c.push_bar(bar(4, 15.0));
    assert_eq!(c.bars().len(), 4);
    assert_eq!(c.bars()[2].close, 14.0);
}
#[test]
fn truncate_to_keeps_matching_timestamp() {
    let mut chart = populated();
    chart.truncate_to(2);
    assert_eq!(chart.bars().last().map(|bar| bar.time), Some(2));
}

#[test]
fn resize_preserves_visible_right_edge() {
    let mut chart = populated();
    let right = chart.visible_range().unwrap().to;
    chart.resize(350.0, 300.0);
    assert_eq!(chart.visible_range().unwrap().to, right);
}

#[test]
fn invalid_pan_zoom_are_ignored_and_zoom_clamps() {
    let mut chart = populated();
    let before = chart.visible_range().unwrap();
    chart.pan(f64::NAN);
    chart.zoom(0.0, 20.0);
    chart.zoom(f64::MAX, 350.0);
    assert_eq!(chart.visible_range().unwrap(), before);
    chart.zoom(0.0001, 350.0);
    let range = chart.visible_range().unwrap();
    assert!(range.to - range.from >= 4.0);
}

#[test]
fn normal_scale_and_time_transforms_round_trip() {
    let chart = populated();
    let x = chart.time_to_x(2).unwrap();
    assert_eq!(chart.x_to_time(x), Some(2));
    let y = chart.price_to_y(11.0).unwrap();
    assert!((chart.y_to_price(y).unwrap() - 11.0).abs() < 1e-9);
}

#[test]
fn manual_price_range_survives_append() {
    let mut chart = populated();
    let manual = PriceRange { min: 1.0, max: 2.0 };
    chart.set_price_range(Some(manual));
    chart.push_bar(bar(4, 100.0));
    assert_eq!(chart.price_range(), manual);
}
#[test]
fn appending_shifts_following_logical_viewport() {
    let mut chart = populated();
    let before = chart.visible_range().unwrap();
    chart.push_bar(bar(4, 14.0));
    let after = chart.visible_range().unwrap();
    assert_eq!(after.from, before.from + 1.0);
    assert_eq!(after.to, before.to + 1.0);
}
#[test]
fn cap_keeps_latest_sorted_bars() {
    let mut chart = ChartEngine::new();
    let bars: Vec<_> = (0..6005).map(|time| bar(time, 10.0)).collect();
    chart.set_history(&bars);
    assert_eq!(chart.bars().len(), 6000);
    assert_eq!(chart.bars().first().unwrap().time, 5);
    assert_eq!(chart.bars().last().unwrap().time, 6004);
}

#[test]
fn history_is_sorted_and_invalid_ohlc_is_dropped() {
    let mut chart = ChartEngine::new();
    let invalid = Bar {
        time: 4,
        open: 20.0,
        high: 19.0,
        low: 10.0,
        close: 15.0,
        volume: 1.0,
    };
    chart.set_history(&[bar(3, 11.0), invalid, bar(1, 10.0)]);
    assert_eq!(
        chart.bars().iter().map(|bar| bar.time).collect::<Vec<_>>(),
        [1, 3],
    );
}

#[test]
fn spacer_times_round_trip_through_coordinates() {
    let mut chart = populated();
    chart.set_spacer_times(&[5, 4, 4, 3]);
    chart.set_right_offset(0.0);
    let x = chart.time_to_x(4).unwrap();
    assert_eq!(chart.x_to_time(x), Some(4));
    assert_eq!(chart.x_to_time(chart.time_to_x(3).unwrap()), Some(3));
    assert!(chart.focus_time(5));
}
#[test]
fn spacers_do_not_shift_following_view_but_preserve_manual_view() {
    let mut following = populated();
    let before = following.visible_range().unwrap();
    following.set_spacer_times(&[4, 5, 6]);
    assert_eq!(following.visible_range(), Some(before));
    following.set_spacer_times(&[]);
    assert_eq!(following.visible_range(), Some(before));

    let mut panned = populated();
    assert!(panned.set_visible_range(0.0, 1.0));
    let before = panned.visible_range().unwrap();
    panned.set_spacer_times(&[4, 5, 6]);
    assert_eq!(panned.visible_range(), Some(before));
}
#[test]
fn future_spacers_do_not_advance_follow_viewport_past_last_bar() {
    let mut chart = populated();
    let before = chart.visible_range().unwrap();
    let spacers = (4..196).collect::<Vec<_>>();
    chart.set_spacer_times(&spacers);
    assert_eq!(chart.visible_range(), Some(before));
    assert_eq!(chart.render_geometry().len(), 3);
}

#[test]
fn latest_explicit_view_follows_new_bars_without_right_offset() {
    let mut chart = populated();
    assert!(chart.set_visible_range(0.0, 2.0));
    let before = chart.visible_range().unwrap();
    chart.push_bar(bar(4, 14.0));
    let after = chart.visible_range().unwrap();
    assert_eq!(after.from, before.from + 1.0);
    assert_eq!(after.to, before.to + 1.0);
}

#[test]
fn right_offset_change_preserves_a_manually_panned_view() {
    let mut chart = populated();
    assert!(chart.set_visible_range(0.0, 1.0));
    let before = chart.visible_range().unwrap();
    chart.set_right_offset(0.0);
    assert_eq!(chart.visible_range(), Some(before));
}

#[test]
fn inverted_price_scale_reverses_vertical_direction_and_round_trips() {
    let mut chart = populated();
    chart.set_inverted_scale(true);
    let low_y = chart.price_to_y(9.0).unwrap();
    let high_y = chart.price_to_y(13.0).unwrap();
    assert!(high_y > low_y);
    assert!((chart.y_to_price(high_y).unwrap() - 13.0).abs() < 1e-9);
}

#[test]
fn empty_history_resets_automatic_range() {
    let mut chart = populated();
    chart.truncate_to(0);
    assert_eq!(chart.price_range(), PriceRange { min: 0.0, max: 1.0 });
}
#[test]
fn visible_range_controls_autoscale() {
    let mut chart = populated();
    assert!(chart.set_visible_range(1.0, 3.0));
    assert_eq!(
        chart.price_range(),
        PriceRange {
            min: 9.0,
            max: 13.0
        }
    );
    assert!(!chart.set_visible_range(3.0, 1.0));
    assert_eq!(
        chart.price_range(),
        PriceRange {
            min: 9.0,
            max: 13.0
        }
    );
}

#[test]
fn percentage_scale_round_trips_from_visible_start() {
    let mut chart = populated();
    assert!(chart.set_visible_range(1.0, 3.0));
    chart.set_price_scale_mode(PriceScaleMode::Percentage);
    let y = chart.price_to_y(12.0).unwrap();
    assert!((chart.y_to_price(y).unwrap() - 12.0).abs() < 1e-9);
}

#[test]
fn logarithmic_scale_matches_lightweight_charts_signed_transform() {
    let mut chart = populated();
    chart.set_price_range(Some(PriceRange {
        min: -100.0,
        max: 100.0,
    }));
    chart.set_price_scale_mode(PriceScaleMode::Logarithmic);
    let expected = 100.0001_f64.log10() + 4.0;
    for (price, expected_scale) in [
        (-100.0, -expected),
        (-1.0, -(1.0001_f64.log10() + 4.0)),
        (0.0, 0.0),
        (1.0, 1.0001_f64.log10() + 4.0),
        (100.0, expected),
    ] {
        let y = chart.price_to_y(price).unwrap();
        assert!((chart.y_to_price(y).unwrap() - price).abs() < 1e-8);
        assert!((to_log_scale(price) - expected_scale).abs() < 1e-10);
    }
}

#[test]
fn percentage_scale_matches_lwc_for_negative_base_and_falls_back_at_zero() {
    let mut chart = populated();
    chart.set_history(&[
        Bar {
            time: 1,
            open: -10.0,
            high: -9.0,
            low: -11.0,
            close: -10.0,
            volume: 1.0,
        },
        Bar {
            time: 2,
            open: -12.0,
            high: -11.0,
            low: -13.0,
            close: -12.0,
            volume: 1.0,
        },
    ]);
    assert!(chart.set_visible_range(0.0, 2.0));
    chart.set_price_scale_mode(PriceScaleMode::Percentage);
    assert!((chart.price_to_scale_value(-12.0).unwrap() - (-20.0)).abs() < 1e-9);
    for price in [-13.0, -12.0, -10.0, -9.0] {
        let y = chart.price_to_y(price).unwrap();
        assert!((chart.y_to_price(y).unwrap() - price).abs() < 1e-8);
    }

    chart.set_history(&[
        Bar {
            time: 1,
            open: 0.0,
            high: 1.0,
            low: -1.0,
            close: 0.0,
            volume: 1.0,
        },
        Bar {
            time: 2,
            open: 2.0,
            high: 3.0,
            low: 1.0,
            close: 2.0,
            volume: 1.0,
        },
    ]);
    assert!(chart.set_visible_range(0.0, 2.0));
    assert_eq!(chart.price_to_scale_value(2.0), Some(2.0));
    assert!(chart.price_to_y(2.0).is_some());
    assert!((chart.y_to_price(chart.price_to_y(2.0).unwrap()).unwrap() - 2.0).abs() < 1e-8);
}

#[test]
fn inversion_is_independent_of_log_and_percentage_modes() {
    let mut chart = populated();
    chart.set_price_scale_mode(PriceScaleMode::Logarithmic);
    let normal_high = chart.price_to_y(13.0).unwrap();
    chart.set_inverted_scale(true);
    assert_eq!(chart.price_scale_mode(), PriceScaleMode::Logarithmic);
    assert!(chart.price_to_y(13.0).unwrap() > normal_high);

    chart.set_price_scale_mode(PriceScaleMode::Percentage);
    let percentage = chart.price_to_scale_value(13.0);
    chart.set_inverted_scale(false);
    assert_eq!(chart.price_scale_mode(), PriceScaleMode::Percentage);
    assert_eq!(chart.price_to_scale_value(13.0), percentage);
    assert!(chart.price_to_y(13.0).unwrap() < chart.price_to_y(9.0).unwrap());
}
#[test]
fn scale_coordinate_conversions_match_active_price_scale() {
    let mut chart = populated();
    assert_eq!(chart.price_to_scale_coordinate(12.0), Some(12.0));
    assert_eq!(chart.scale_coordinate_to_price(12.0), Some(12.0));

    chart.set_price_scale_mode(PriceScaleMode::Logarithmic);
    for price in [-100.0, -1.0, 0.0, 1.0, 100.0] {
        let scale = chart.price_to_scale_coordinate(price).unwrap();
        assert!((chart.scale_coordinate_to_price(scale).unwrap() - price).abs() < 1e-8);
    }

    chart.set_history(&[
        Bar {
            time: 1,
            open: -10.0,
            high: -9.0,
            low: -11.0,
            close: -10.0,
            volume: 1.0,
        },
        Bar {
            time: 2,
            open: -12.0,
            high: -11.0,
            low: -13.0,
            close: -12.0,
            volume: 1.0,
        },
    ]);
    assert!(chart.set_visible_range(0.0, 2.0));
    chart.set_price_scale_mode(PriceScaleMode::Percentage);
    for price in [-13.0, -12.0, -10.0, -9.0] {
        let scale = chart.price_to_scale_coordinate(price).unwrap();
        assert!((chart.scale_coordinate_to_price(scale).unwrap() - price).abs() < 1e-8);
    }

    chart.set_history(&[
        Bar {
            time: 1,
            open: 0.0,
            high: 1.0,
            low: -1.0,
            close: 0.0,
            volume: 1.0,
        },
        Bar {
            time: 2,
            open: 2.0,
            high: 3.0,
            low: 1.0,
            close: 2.0,
            volume: 1.0,
        },
    ]);
    assert!(chart.set_visible_range(0.0, 2.0));
    assert_eq!(chart.price_to_scale_coordinate(2.0), Some(2.0));
    assert_eq!(chart.scale_coordinate_to_price(2.0), Some(2.0));
}

#[test]
fn geometry_uses_f64_flags_and_a_separate_volume_pane() {
    let mut chart = populated();
    chart.set_right_offset(0.0);
    let first = chart.render_geometry()[0];
    assert_eq!(first.up, 1.0);
    assert_eq!(first.candle, 1.0);
    assert_eq!(first.volume_bottom, 120.0);
    chart.set_chart_type(ChartType::Line);
    assert_eq!(chart.render_geometry()[0].candle, 0.0);
}

#[test]
fn bar_and_spacer_time_coordinate_round_trip() {
    let mut chart = populated();
    chart.set_spacer_times(&[4]);
    chart.set_right_offset(0.0);
    for time in [1, 2, 3, 4] {
        let x = chart.time_to_x(time).unwrap();
        assert_eq!(chart.x_to_time(x), Some(time));
    }
}
