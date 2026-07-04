package telegram

import "testing"

func TestWebOriginated(t *testing.T) {
	cases := []struct {
		name string
		meta map[string]string
		want bool
	}{
		{"nil meta", nil, false},
		{"web origin", map[string]string{"origin": "web", "sender": "user:web"}, true},
		{"telegram meta", map[string]string{"sender": "user:42", "chat_id": "42"}, false},
		{"empty origin", map[string]string{"origin": ""}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := webOriginated(c.meta); got != c.want {
				t.Errorf("webOriginated(%v) = %v, want %v", c.meta, got, c.want)
			}
		})
	}
}
