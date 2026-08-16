package analytics

import "math"

// Two-sided Student's t p-value, via the regularized incomplete beta
// function (Lanczos approximation for log-gamma + a continued-fraction
// expansion for the incomplete beta integral — the standard
// numerically-stable approach). Implemented directly against math.* rather
// than pulling in a stats dependency: the whole numerical core is ~80
// lines, it's exactly the kind of small, testable helper stdlib doesn't
// provide, and a dependency would cost more in review/supply-chain surface
// than it saves here. If a future need justifies a real stats package,
// pin its version and note the trade-off explicitly — don't add it "just
// for this".

// logGamma returns ln(Gamma(value)) via the Lanczos approximation
// (g=7, n=9 coefficients — the widely-used reference constants).
func logGamma(value float64) float64 {
	coefficients := []float64{
		676.5203681218851, -1259.1392167224028, 771.3234287776531,
		-176.6150291621406, 12.507343278686905, -0.13857109526572012,
		9.984369578019572e-6, 1.5056327351493116e-7,
	}
	if value < 0.5 {
		// Reflection formula: Gamma(z)Gamma(1-z) = pi/sin(pi*z).
		return math.Log(math.Pi) - math.Log(math.Sin(math.Pi*value)) - logGamma(1-value)
	}
	x := 0.9999999999998099
	shifted := value - 1
	for index, coefficient := range coefficients {
		x += coefficient / (shifted + float64(index) + 1)
	}
	t := shifted + float64(len(coefficients)) - 0.5
	return 0.5*math.Log(2*math.Pi) + (shifted+0.5)*math.Log(t) - t + math.Log(x)
}

// betaContinuedFraction evaluates the continued-fraction part of the
// regularized incomplete beta function I_x(a,b) (Lentz's algorithm).
func betaContinuedFraction(a, b, x float64) float64 {
	const maxIterations = 200
	const fpMinimum = 1e-30
	qab := a + b
	qap := a + 1
	qam := a - 1
	c := 1.0
	d := 1 - qab*x/qap
	if math.Abs(d) < fpMinimum {
		d = fpMinimum
	}
	d = 1 / d
	result := d
	for iteration := 1; iteration <= maxIterations; iteration++ {
		doubled := float64(iteration * 2)
		numerator := float64(iteration) * (b - float64(iteration)) * x / ((qam + doubled) * (a + doubled))
		d = 1 + numerator*d
		if math.Abs(d) < fpMinimum {
			d = fpMinimum
		}
		c = 1 + numerator/c
		if math.Abs(c) < fpMinimum {
			c = fpMinimum
		}
		d = 1 / d
		result *= d * c
		numerator = -(a + float64(iteration)) * (qab + float64(iteration)) * x / ((a + doubled) * (qap + doubled))
		d = 1 + numerator*d
		if math.Abs(d) < fpMinimum {
			d = fpMinimum
		}
		c = 1 + numerator/c
		if math.Abs(c) < fpMinimum {
			c = fpMinimum
		}
		d = 1 / d
		delta := d * c
		result *= delta
		if math.Abs(delta-1) < 3e-10 {
			break
		}
	}
	return result
}

// regularizedIncompleteBeta computes I_x(a,b), clamped to [0,1].
func regularizedIncompleteBeta(x, a, b float64) float64 {
	if x <= 0 {
		return 0
	}
	if x >= 1 {
		return 1
	}
	factor := math.Exp(logGamma(a+b) - logGamma(a) - logGamma(b) + a*math.Log(x) + b*math.Log(1-x))
	if x < (a+1)/(a+b+2) {
		return factor * betaContinuedFraction(a, b, x) / a
	}
	return 1 - factor*betaContinuedFraction(b, a, 1-x)/b
}

// twoSidedStudentTPValue returns the two-sided p-value of tStat under a
// Student's t distribution with degreesOfFreedom, via the standard
// t-to-incomplete-beta identity: P(|T| >= |t|) = I_x(df/2, 1/2) where
// x = df/(df+t^2). Non-finite tStat or non-positive degrees of freedom
// return a safe boundary value rather than propagating NaN/Inf.
func twoSidedStudentTPValue(tStat, degreesOfFreedom float64) float64 {
	if math.IsNaN(tStat) || math.IsInf(tStat, 0) {
		return 0
	}
	if degreesOfFreedom <= 0 {
		return 1
	}
	x := degreesOfFreedom / (degreesOfFreedom + tStat*tStat)
	p := regularizedIncompleteBeta(x, degreesOfFreedom/2, 0.5)
	if p < 0 {
		return 0
	}
	if p > 1 {
		return 1
	}
	return p
}
