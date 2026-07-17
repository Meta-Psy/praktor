package store

import "testing"

func mkThread(id, project, title string) Thread {
	return Thread{ID: id, ProjectKey: project, Title: title, Status: "active"}
}

func TestThreadCRUD(t *testing.T) {
	s := newTestStore(t)

	if err := s.CreateThread(mkThread("t1", "praktor", "Штаб UX")); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.CreateThread(mkThread("t2", "praktor", "Контроль проектов")); err != nil {
		t.Fatalf("create second: %v", err)
	}

	got, err := s.GetThread("t1")
	if err != nil || got == nil {
		t.Fatalf("get: %v, %+v", err, got)
	}
	if got.Title != "Штаб UX" || got.Status != "active" || got.CreatedAt == "" {
		t.Errorf("got = %+v", got)
	}
	if missing, err := s.GetThread("nope"); err != nil || missing != nil {
		t.Fatalf("get missing: %v, %+v", err, missing)
	}

	all, err := s.ListThreads()
	if err != nil || len(all) != 2 {
		t.Fatalf("list: %v, len=%d want 2", err, len(all))
	}

	got.Summary = "редизайн"
	got.Status = "done"
	got.EndedAt = "2026-07-08"
	if err := s.UpdateThread(*got); err != nil {
		t.Fatalf("update: %v", err)
	}
	got2, _ := s.GetThread("t1")
	if got2.Summary != "редизайн" || got2.Status != "done" || got2.EndedAt == "" {
		t.Errorf("after update = %+v", got2)
	}

	if err := s.DeleteThread("t1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if gone, _ := s.GetThread("t1"); gone != nil {
		t.Errorf("still exists: %+v", gone)
	}
}

func TestThreadBranchParent(t *testing.T) {
	s := newTestStore(t)
	if err := s.CreateThread(mkThread("root", "praktor", "Ядро")); err != nil {
		t.Fatalf("create root: %v", err)
	}
	if err := s.CreatePoint(ThreadPoint{ID: "p1", ThreadID: "root", Kind: "pr",
		Title: "PR #3", Repo: "Meta-Psy/praktor", PRNumber: 3, PRState: "merged", Confirmed: true}); err != nil {
		t.Fatalf("create point: %v", err)
	}
	branch := mkThread("br", "praktor", "Штаб UX")
	branch.ParentPointID = "p1"
	if err := s.CreateThread(branch); err != nil {
		t.Fatalf("create branch: %v", err)
	}
	got, _ := s.GetThread("br")
	if got.ParentPointID != "p1" {
		t.Errorf("parent = %q, want p1", got.ParentPointID)
	}
	// удаление точки ветвления не убивает нить (ON DELETE SET NULL)
	if err := s.DeletePoint("p1"); err != nil {
		t.Fatalf("delete point: %v", err)
	}
	got2, _ := s.GetThread("br")
	if got2 == nil || got2.ParentPointID != "" {
		t.Errorf("after point delete = %+v, want parent=''", got2)
	}
}

func TestPointCRUDAndInbox(t *testing.T) {
	s := newTestStore(t)
	_ = s.CreateThread(mkThread("t1", "praktor", "Штаб UX"))

	merged := ThreadPoint{ID: "p1", ThreadID: "t1", Kind: "pr", Title: "PR #24",
		Repo: "Meta-Psy/praktor", PRNumber: 24, PRUrl: "https://github.com/Meta-Psy/praktor/pull/24",
		PRState: "merged", EventDate: "2026-07-07", Position: 1, Confirmed: true}
	planned := ThreadPoint{ID: "p2", ThreadID: "t1", Kind: "planned",
		Title: "чек-лист прода", Position: 2, Confirmed: true}
	suggested := ThreadPoint{ID: "p3", ThreadID: "t1", Kind: "pr", Title: "PR #26",
		Repo: "Meta-Psy/praktor", PRNumber: 26, PRState: "open", Confirmed: false}
	orphan := ThreadPoint{ID: "p4", Kind: "pr", Title: "PR #9",
		Repo: "Meta-Psy/other", PRNumber: 9, PRState: "open", Confirmed: false}
	for _, p := range []ThreadPoint{merged, planned, suggested, orphan} {
		if err := s.CreatePoint(p); err != nil {
			t.Fatalf("create %s: %v", p.ID, err)
		}
	}

	// UNIQUE(repo, pr_number)
	if err := s.CreatePoint(ThreadPoint{ID: "dup", Kind: "pr", Repo: "Meta-Psy/praktor",
		PRNumber: 24, Title: "dup"}); err == nil {
		t.Fatal("duplicate repo+pr_number must fail")
	}

	all, err := s.ListPoints()
	if err != nil || len(all) != 4 {
		t.Fatalf("list: %v, len=%d want 4", err, len(all))
	}

	inbox, err := s.ListInboxPoints()
	if err != nil || len(inbox) != 2 {
		t.Fatalf("inbox: %v, len=%d want 2", err, len(inbox))
	}

	// confirm: p3 в t1
	if err := s.ConfirmPoint("p3", "t1"); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	inbox2, _ := s.ListInboxPoints()
	if len(inbox2) != 1 || inbox2[0].ID != "p4" {
		t.Fatalf("inbox after confirm = %+v", inbox2)
	}

	// правка и удаление
	planned.Title = "чек-лист прода PR#24"
	if err := s.UpdatePoint(planned); err != nil {
		t.Fatalf("update: %v", err)
	}
	if err := s.DeletePoint("p4"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if left, _ := s.ListPoints(); len(left) != 3 {
		t.Fatalf("after delete len=%d want 3", len(left))
	}

	// каскад: удаление нити убирает её точки
	if err := s.DeleteThread("t1"); err != nil {
		t.Fatalf("delete thread: %v", err)
	}
	if left, _ := s.ListPoints(); len(left) != 0 {
		t.Fatalf("cascade failed, len=%d want 0", len(left))
	}
}

func TestMaterializePoint(t *testing.T) {
	s := newTestStore(t)
	_ = s.CreateThread(mkThread("t1", "praktor", "Контроль проектов"))
	_ = s.CreatePoint(ThreadPoint{ID: "plan", ThreadID: "t1", Kind: "planned",
		Title: "нити идей", Position: 5, Confirmed: true})
	_ = s.CreatePoint(ThreadPoint{ID: "pr", Kind: "pr", Title: "feat: idea threads",
		Repo: "Meta-Psy/praktor", PRNumber: 30, PRUrl: "u", PRState: "open", Confirmed: false})

	if err := s.MaterializePoint("pr", "plan", "t1"); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	pts, _ := s.ListPoints()
	if len(pts) != 1 {
		t.Fatalf("len=%d want 1 (pr-точка слилась в planned)", len(pts))
	}
	got := pts[0]
	if got.ID != "plan" || got.Kind != "pr" || got.PRNumber != 30 ||
		got.PRState != "open" || !got.Confirmed || got.Position != 5 ||
		got.Title != "нити идей" {
		t.Errorf("materialized = %+v", got)
	}
}

func TestConfirmPointMissing(t *testing.T) {
	s := newTestStore(t)
	_ = s.CreateThread(mkThread("t1", "praktor", "Штаб UX"))
	if err := s.ConfirmPoint("nope", "t1"); err == nil {
		t.Fatal("confirm of missing point must fail")
	}
}

func TestMaterializeRollbackAndGetPoint(t *testing.T) {
	s := newTestStore(t)
	_ = s.CreateThread(mkThread("t1", "praktor", "Контроль проектов"))
	_ = s.CreateThread(mkThread("t2", "praktor", "Другая"))
	_ = s.CreatePoint(ThreadPoint{ID: "plan", ThreadID: "t1", Kind: "planned", Title: "нити идей", Confirmed: true})
	_ = s.CreatePoint(ThreadPoint{ID: "pr", Kind: "pr", Title: "x", Repo: "Meta-Psy/praktor", PRNumber: 30, PRState: "open", Confirmed: false})

	// несуществующий pr — ошибка
	if err := s.MaterializePoint("ghost", "plan", "t1"); err == nil {
		t.Fatal("missing pr point must fail")
	}
	// planned из другой нити — ошибка, pr-строка пережила rollback
	if err := s.MaterializePoint("pr", "plan", "t2"); err == nil {
		t.Fatal("thread mismatch must fail")
	}
	if p, err := s.GetPoint("pr"); err != nil || p == nil || p.PRNumber != 30 {
		t.Fatalf("pr point must survive rollback: %v, %+v", err, p)
	}
	if missing, err := s.GetPoint("ghost"); err != nil || missing != nil {
		t.Fatalf("GetPoint missing: %v, %+v", err, missing)
	}
}

func TestIdeasAndNotes(t *testing.T) {
	s := newTestStore(t)
	_ = s.CreateThread(mkThread("t1", "praktor", "Контроль проектов"))
	_ = s.CreateThread(mkThread("t2", "mentis", "Контент-фабрика"))

	if err := s.CreateIdea(Idea{ID: "i1", Title: "Контроль всех проектов", Status: "active"}); err != nil {
		t.Fatalf("create idea: %v", err)
	}
	if err := s.SetIdeaThreads("i1", []string{"t1", "t2"}); err != nil {
		t.Fatalf("set idea threads: %v", err)
	}
	ideas, err := s.ListIdeas()
	if err != nil || len(ideas) != 1 {
		t.Fatalf("list ideas: %v, len=%d", err, len(ideas))
	}
	if len(ideas[0].ThreadIDs) != 2 {
		t.Errorf("thread_ids = %v, want 2", ideas[0].ThreadIDs)
	}

	// замена связей
	if err := s.SetIdeaThreads("i1", []string{"t2"}); err != nil {
		t.Fatalf("replace: %v", err)
	}
	ideas, _ = s.ListIdeas()
	if len(ideas[0].ThreadIDs) != 1 || ideas[0].ThreadIDs[0] != "t2" {
		t.Errorf("after replace = %v", ideas[0].ThreadIDs)
	}

	// каскад: удаление нити чистит связь
	_ = s.DeleteThread("t2")
	ideas, _ = s.ListIdeas()
	if len(ideas[0].ThreadIDs) != 0 {
		t.Errorf("after thread delete = %v", ideas[0].ThreadIDs)
	}

	if err := s.DeleteIdea("i1"); err != nil {
		t.Fatalf("delete idea: %v", err)
	}
	if ideas, _ = s.ListIdeas(); len(ideas) != 0 {
		t.Errorf("ideas left = %d", len(ideas))
	}

	// заметки
	if err := s.CreateNote(ThreadNote{ID: "n1", ThreadID: "t1", Body: "решение: сначала карта", Source: "chat"}); err != nil {
		t.Fatalf("create note: %v", err)
	}
	notes, err := s.ListNotes("t1")
	if err != nil || len(notes) != 1 || notes[0].Body != "решение: сначала карта" {
		t.Fatalf("notes: %v, %+v", err, notes)
	}
}
