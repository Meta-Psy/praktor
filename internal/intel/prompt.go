package intel

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mtzanidakis/praktor/internal/store"
)

const outputContract = `Return ONLY a single JSON object in a fenced code block, with this shape:
{
  "summary": "1-2 sentences on the current state",
  "metrics": { "<name>": <number> },
  "items": [ { "name": "...", "note": "..." } ],
  "change_note": "what changed vs the previous snapshot"
}`

// buildPrompt assembles the scrape instruction, the previous snapshot (if any),
// and the structured-output contract into one agent prompt.
func buildPrompt(instruction string, prev *store.IntelSnapshot) string {
	var b strings.Builder
	b.WriteString(instruction)
	b.WriteString("\n\n")
	if prev != nil && prev.Payload != "" {
		b.WriteString("Previous snapshot (compare against it for change_note):\n")
		b.WriteString(prev.Payload)
		b.WriteString("\n\n")
	} else {
		b.WriteString("There is no previous snapshot — set change_note to \"first snapshot\".\n\n")
	}
	b.WriteString(outputContract)
	return b.String()
}

// parseSnapshot extracts the JSON object from an agent response. It tolerates a
// fenced ```json block or a bare object embedded in prose.
func parseSnapshot(text string) (Snapshot, error) {
	raw := extractJSON(text)
	if raw == "" {
		return Snapshot{}, fmt.Errorf("no JSON object found in agent response")
	}
	var snap Snapshot
	if err := json.Unmarshal([]byte(raw), &snap); err != nil {
		return Snapshot{}, fmt.Errorf("unmarshal snapshot: %w", err)
	}
	return snap, nil
}

// extractJSON returns the first balanced {...} region of s, or "".
func extractJSON(s string) string {
	start := strings.Index(s, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}
