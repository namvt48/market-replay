package analytics

import (
	"math"
	"testing"
)

// Reference values verified against scipy.stats.t.sf (2*sf(|t|, df)):
//
//	python3 -c "from scipy import stats; print(2*stats.t.sf(2.0, 10))"
func TestTwoSidedStudentTPValue_KnownReferenceValues(t *testing.T) {
	cases := []struct {
		tStat, df, want float64
	}{
		{2.0, 10, 0.07338803477074037},
		{2.228, 10, 0.05001177181711132},
		{1.812, 10, 0.10007526206584715},
		{3.169, 15, 0.006354511463720709},
		{0, 15, 1.0},
	}
	const tolerance = 1e-6
	for _, c := range cases {
		got := twoSidedStudentTPValue(c.tStat, c.df)
		if math.Abs(got-c.want) > tolerance {
			t.Errorf("twoSidedStudentTPValue(%v, %v) = %v, want %v (±%v)", c.tStat, c.df, got, c.want, tolerance)
		}
	}
}

func TestTwoSidedStudentTPValue_SymmetricInSign(t *testing.T) {
	for _, df := range []float64{5, 10, 30, 100} {
		for _, tStat := range []float64{0.5, 1.5, 2.5} {
			pos := twoSidedStudentTPValue(tStat, df)
			neg := twoSidedStudentTPValue(-tStat, df)
			if math.Abs(pos-neg) > 1e-9 {
				t.Errorf("df=%v tStat=%v: p(t)=%v != p(-t)=%v, want symmetric", df, tStat, pos, neg)
			}
		}
	}
}

func TestTwoSidedStudentTPValue_LargerTStatIsSmallerPValue(t *testing.T) {
	const df = 20
	prev := 1.0
	for _, tStat := range []float64{0, 1, 2, 3, 4, 5} {
		p := twoSidedStudentTPValue(tStat, df)
		if p > prev {
			t.Errorf("p-value not monotonically decreasing: tStat=%v p=%v, previous=%v", tStat, p, prev)
		}
		prev = p
	}
}

func TestTwoSidedStudentTPValue_DegenerateInputsNeverNaNOrInf(t *testing.T) {
	cases := []struct{ tStat, df float64 }{
		{math.NaN(), 10},
		{math.Inf(1), 10},
		{math.Inf(-1), 10},
		{2.0, 0},
		{2.0, -5},
	}
	for _, c := range cases {
		p := twoSidedStudentTPValue(c.tStat, c.df)
		if isNaNOrInf(p) || p < 0 || p > 1 {
			t.Errorf("twoSidedStudentTPValue(%v, %v) = %v, want a value in [0,1]", c.tStat, c.df, p)
		}
	}
}
