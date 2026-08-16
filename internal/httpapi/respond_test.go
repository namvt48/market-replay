package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
)

func TestWriteErrorRespectingCancellation_SeparatesCanceledFromDeadlineExceeded(t *testing.T) {
	canceledRec := httptest.NewRecorder()
	writeErrorRespectingCancellation(canceledRec, context.Canceled)
	if canceledRec.Code != statusClientClosedRequest {
		t.Errorf("context.Canceled -> status %d, want %d", canceledRec.Code, statusClientClosedRequest)
	}

	deadlineRec := httptest.NewRecorder()
	writeErrorRespectingCancellation(deadlineRec, context.DeadlineExceeded)
	if deadlineRec.Code != 504 {
		t.Errorf("context.DeadlineExceeded -> status %d, want 504 (not conflated with client-cancel 499)", deadlineRec.Code)
	}

	otherRec := httptest.NewRecorder()
	writeErrorRespectingCancellation(otherRec, errors.New("boom"))
	if otherRec.Code != 500 {
		t.Errorf("plain error -> status %d, want 500", otherRec.Code)
	}
}
