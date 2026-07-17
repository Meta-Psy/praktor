package threads

import (
	"strings"

	"github.com/mtzanidakis/praktor/internal/store"
)

// slugify нормализует строку в слаг: нижний регистр, последовательности
// не-букв/цифр → одиночный дефис. Кириллица сохраняется.
func slugify(s string) string {
	var b strings.Builder
	prevDash := true // подавить ведущий дефис
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r >= 'а' && r <= 'я', r == 'ё':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}

// MatchThread ищет слаг заголовка активной нити в имени ветки и заголовке PR.
// При нескольких попаданиях побеждает самый длинный слаг. Слаги короче
// 4 байт не матчатся — слишком много ложных попаданий. "" = промах (входящие).
func MatchThread(threads []store.Thread, branch, prTitle string) string {
	branchSlug := slugify(branch)
	titleSlug := slugify(prTitle)
	bestID, bestLen := "", 0
	for _, t := range threads {
		if t.Status != "active" {
			continue
		}
		slug := slugify(t.Title)
		if len(slug) < 4 || len(slug) <= bestLen {
			continue
		}
		if strings.Contains(branchSlug, slug) || strings.Contains(titleSlug, slug) {
			bestID, bestLen = t.ID, len(slug)
		}
	}
	return bestID
}
