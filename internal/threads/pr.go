// Package threads реализует синк «нитей идей» с GitHub: обновление статусов
// PR-точек и эвристическую привязку новых PR к нитям (через входящие).
// См. _specs/2026-07-17-praktor-idea-threads-design.md §2.
package threads

// PR — один pull request из GitHub (state=all).
type PR struct {
	Number    int64
	Title     string
	URL       string
	State     string // open|closed
	MergedAt  string // RFC3339; "" = не влит
	ClosedAt  string
	CreatedAt string
	HeadRef   string // имя ветки
}

// PRState сводит состояние GitHub к pr_state точки: merged|open|closed.
func (p PR) PRState() string {
	if p.MergedAt != "" {
		return "merged"
	}
	if p.State == "closed" {
		return "closed"
	}
	return "open"
}

// EventDate — дата для оси карты: merged_at / closed_at / created_at.
func (p PR) EventDate() string {
	if p.MergedAt != "" {
		return p.MergedAt
	}
	if p.ClosedAt != "" {
		return p.ClosedAt
	}
	return p.CreatedAt
}
