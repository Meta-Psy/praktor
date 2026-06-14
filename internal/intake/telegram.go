package intake

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/mtzanidakis/praktor/internal/speech"
	"github.com/mymmrac/telego"
	th "github.com/mymmrac/telego/telegohandler"
	tu "github.com/mymmrac/telego/telegoutil"
)

// queuePutter is the queue surface the poller needs (satisfied by *Queue).
type queuePutter interface {
	Put(ctx context.Context, it Item) error
	PutMedia(ctx context.Context, id, name string, data []byte) (string, error)
}

type mediaBlob struct {
	Name string
	Data []byte
}

// Poller is a minimal Telegram long-poll adapter that turns voice/photo/text
// into intake Items. It owns the intake token; the full orchestrator bot stays
// disabled (Telegram.Token empty).
type Poller struct {
	bot      *telego.Bot
	speech   *speech.Client
	queue    queuePutter
	allow    map[int64]bool
	now      func() time.Time
	idSuffix func() string
}

// NewPoller constructs a poller. allowFrom restricts who may submit (empty = any).
func NewPoller(token string, speechClient *speech.Client, queue queuePutter, allowFrom []int64) (*Poller, error) {
	bot, err := telego.NewBot(token)
	if err != nil {
		return nil, fmt.Errorf("intake telegram bot: %w", err)
	}
	allow := make(map[int64]bool, len(allowFrom))
	for _, id := range allowFrom {
		allow[id] = true
	}
	return &Poller{
		bot:      bot,
		speech:   speechClient,
		queue:    queue,
		allow:    allow,
		now:      time.Now,
		idSuffix: randSuffix,
	}, nil
}

func randSuffix() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// enqueue builds an Item (writing any media first) and queues it.
func (p *Poller) enqueue(ctx context.Context, text string, blobs []mediaBlob, project string) error {
	id := p.now().UTC().Format("20060102T150405Z") + "-" + p.idSuffix()
	var media []string
	for _, b := range blobs {
		path, err := p.queue.PutMedia(ctx, id, b.Name, b.Data)
		if err != nil {
			return err
		}
		media = append(media, path)
	}
	it := Assemble("telegram", text, media, project, p.now(), "x")
	it.ID = id
	return p.queue.Put(ctx, it)
}

// downloadFile fetches a Telegram file's bytes by FileID.
func (p *Poller) downloadFile(ctx context.Context, fileID string) ([]byte, error) {
	file, err := p.bot.GetFile(ctx, &telego.GetFileParams{FileID: fileID})
	if err != nil {
		return nil, err
	}
	return tu.DownloadFile(p.bot.FileDownloadURL(file.FilePath))
}

// handle turns one message into an intake Item. Voice → STT; photo → media.
func (p *Poller) handle(ctx context.Context, msg telego.Message) {
	if len(p.allow) > 0 {
		// Reject when a sender allowlist is set and the message has no
		// identifiable sender (channel/anonymous) or is not on the list.
		if msg.From == nil || !p.allow[msg.From.ID] {
			return
		}
	}
	text := msg.Text
	if text == "" {
		text = msg.Caption
	}
	var blobs []mediaBlob

	if msg.Voice != nil {
		data, err := p.downloadFile(ctx, msg.Voice.FileID)
		if err != nil {
			slog.Error("intake voice download", "error", err)
		} else if p.speech != nil {
			if spoken, err := p.speech.Transcribe(ctx, data, "voice.ogg"); err == nil {
				if text == "" {
					text = spoken
				} else {
					text = text + "\n\n" + spoken
				}
			} else {
				slog.Error("intake transcribe", "error", err)
			}
		}
	}
	if len(msg.Photo) > 0 {
		photo := msg.Photo[len(msg.Photo)-1]
		if data, err := p.downloadFile(ctx, photo.FileID); err == nil {
			blobs = append(blobs, mediaBlob{Name: "photo.jpg", Data: data})
		} else {
			slog.Error("intake photo download", "error", err)
		}
	}
	if text == "" && len(blobs) == 0 {
		return
	}
	if err := p.enqueue(ctx, text, blobs, ""); err != nil {
		slog.Error("intake enqueue", "error", err)
		_, _ = p.bot.SendMessage(ctx, tu.Message(tu.ID(msg.Chat.ID), "⚠ intake failed: "+err.Error()))
		return
	}
	_, _ = p.bot.SendMessage(ctx, tu.Message(tu.ID(msg.Chat.ID), "✅ принято в очередь"))
}

// Start runs the long-poll loop until ctx is cancelled.
func (p *Poller) Start(ctx context.Context) error {
	updates, err := p.bot.UpdatesViaLongPolling(ctx, nil)
	if err != nil {
		return err
	}
	handler, err := th.NewBotHandler(p.bot, updates)
	if err != nil {
		return err
	}
	handler.HandleMessage(func(_ *th.Context, msg telego.Message) error {
		p.handle(context.Background(), msg)
		return nil
	})
	go func() { _ = handler.Start() }()
	<-ctx.Done()
	_ = handler.Stop()
	return nil
}
