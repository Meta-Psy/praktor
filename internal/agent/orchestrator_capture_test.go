package agent

import "testing"

func TestDeliverCaptureRoutesAndReports(t *testing.T) {
	o := &Orchestrator{pendingReplies: map[string]chan captureResult{}}

	ch := make(chan captureResult, 1)
	o.mu.Lock()
	o.pendingReplies["req1"] = ch
	o.mu.Unlock()

	if !o.deliverCapture(map[string]string{"intel_reply": "req1"}, "hello") {
		t.Fatal("deliverCapture should report handled=true for a known reply id")
	}
	select {
	case res := <-ch:
		if res.content != "hello" {
			t.Errorf("content = %q, want hello", res.content)
		}
	default:
		t.Fatal("expected content on channel")
	}

	if o.deliverCapture(map[string]string{}, "x") {
		t.Error("deliverCapture should report handled=false when no intel_reply")
	}
	if o.deliverCapture(nil, "x") {
		t.Error("deliverCapture(nil) should report handled=false")
	}
}
