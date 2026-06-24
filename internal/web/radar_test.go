package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mtzanidakis/praktor/internal/store"
)

func storeRadarItem(fullName string, stars int, firstSeen string) store.RadarItem {
	return store.RadarItem{
		FullName: fullName, Name: fullName, HTMLURL: "https://github.com/" + fullName,
		Stars: stars, Topic: "mcp", PushedAt: firstSeen, FirstSeen: firstSeen, LastUpdated: firstSeen,
	}
}

func TestHandleRadarEmpty(t *testing.T) {
	st := newTestStoreForWeb(t)
	s := &Server{store: st, radarFreshnessDays: 30}
	rec := httptest.NewRecorder()
	s.handleRadar(rec, httptest.NewRequest(http.MethodGet, "/api/radar", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got radarResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Items == nil {
		t.Error("items should be non-nil empty slice, not null")
	}
	if len(got.Items) != 0 {
		t.Errorf("len = %d, want 0", len(got.Items))
	}
}

func TestHandleRadarIsNew(t *testing.T) {
	st := newTestStoreForWeb(t)
	now := time.Now().UTC()
	recent := now.Add(-2 * 24 * time.Hour).Format(time.RFC3339)
	old := now.Add(-100 * 24 * time.Hour).Format(time.RFC3339)
	_ = st.UpsertRadarItem(storeRadarItem("o/new", 50, recent))
	_ = st.UpsertRadarItem(storeRadarItem("o/old", 80, old))

	s := &Server{store: st, radarFreshnessDays: 30}
	rec := httptest.NewRecorder()
	s.handleRadar(rec, httptest.NewRequest(http.MethodGet, "/api/radar", nil))

	var got radarResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	byName := map[string]radarItem{}
	for _, it := range got.Items {
		byName[it.FullName] = it
	}
	if !byName["o/new"].IsNew {
		t.Error("o/new should be is_new=true")
	}
	if byName["o/old"].IsNew {
		t.Error("o/old should be is_new=false")
	}
}
