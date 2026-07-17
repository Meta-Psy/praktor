package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Telegram  TelegramConfig               `yaml:"telegram"`
	Defaults  DefaultsConfig               `yaml:"defaults"`
	Agents    map[string]AgentDefinition   `yaml:"agents"`
	Router    RouterConfig                 `yaml:"router"`
	NATS      NATSConfig                   `yaml:"nats"`
	Web       WebConfig                    `yaml:"web"`
	Scheduler SchedulerConfig              `yaml:"scheduler"`
	Vault     VaultConfig                  `yaml:"vault"`
	AgentMail AgentMailConfig              `yaml:"agentmail"`
	Speech    SpeechConfig                 `yaml:"speech"`
	Intake    IntakeConfig                 `yaml:"intake"`
	Radar     RadarConfig                  `yaml:"radar"`
	Intel     IntelConfig                  `yaml:"intel"`
	Projects  map[string]ProjectDefinition `yaml:"projects"`
	Threads   ThreadsConfig                `yaml:"threads"`
}

// ProjectDefinition is one project surfaced in the Mission Control roll-up.
type ProjectDefinition struct {
	Repo      string   `yaml:"repo"`       // owner/name on GitHub
	Agents    []string `yaml:"agents"`     // Praktor agent ids associated with this project
	DeployURL string   `yaml:"deploy_url"` // public URL to probe (HTTP 200 = healthy)
	Health    string   `yaml:"health"`     // internal health URL (praktor-net), used if DeployURL empty

	// Deploy mechanism (F.3). Exactly one of DeployWorkflow / DeployHostDir is used.
	DeployWorkflow       string `yaml:"deploy_workflow"`        // GitHub Actions workflow file to dispatch (e.g. deploy.yml)
	DeployHostDir        string `yaml:"deploy_host_dir"`        // host path of a git working copy to pull+rebuild
	DeployComposeProject string `yaml:"deploy_compose_project"` // compose -p name (must match existing stack)
}

type AgentMailConfig struct {
	APIKey string `yaml:"api_key"`
}

type SpeechConfig struct {
	APIKey     string `yaml:"api_key"`
	TTSEnabled bool   `yaml:"tts_enabled"`
	TTSMode    string `yaml:"tts_mode"`
	TTSVoice   string `yaml:"tts_voice"`
}

// IntakeConfig configures the S2 intake Telegram poller. Its token is separate
// from Telegram.Token so the full orchestrator bot stays disabled.
type IntakeConfig struct {
	TelegramToken string `yaml:"telegram_token"`
}

type VaultConfig struct {
	Passphrase string `yaml:"passphrase"`
}

type TelegramConfig struct {
	Token      string  `yaml:"token"`
	AllowFrom  []int64 `yaml:"allow_from"`
	MainChatID int64   `yaml:"main_chat_id"`
}

type DefaultsConfig struct {
	Image           string        `yaml:"image"`
	Model           string        `yaml:"model"`
	MaxRunning      int           `yaml:"max_running"`
	IdleTimeout     time.Duration `yaml:"idle_timeout"`
	AnthropicAPIKey string        `yaml:"anthropic_api_key"`
	OAuthToken      string        `yaml:"oauth_token"`
}

const (
	AgentsBasePath = "data/agents"
	StorePath      = "data/praktor.db"
	NATSPort       = 4222
)

type AgentDefinition struct {
	Description      string            `yaml:"description"`
	Model            string            `yaml:"model"`
	Image            string            `yaml:"image"`
	ClaudeMD         string            `yaml:"claude_md"`
	Workspace        string            `yaml:"workspace"`
	Env              map[string]string `yaml:"env"`
	Files            []FileMount       `yaml:"files"`
	AllowedTools     []string          `yaml:"allowed_tools"`
	NixEnabled       bool              `yaml:"nix_enabled"`
	AgentMailInboxID string            `yaml:"agentmail_inbox_id"`
}

type FileMount struct {
	Secret string `yaml:"secret"`
	Target string `yaml:"target"`
	Mode   string `yaml:"mode"`
}

type RouterConfig struct {
	DefaultAgent string `yaml:"default_agent"`
}

type NATSConfig struct {
	DataDir string `yaml:"data_dir"`
}

type WebConfig struct {
	Enabled bool   `yaml:"enabled"`
	Port    int    `yaml:"port"`
	Auth    string `yaml:"auth"`
}

type SchedulerConfig struct {
	PollInterval time.Duration `yaml:"poll_interval"`
}

// IntelConfig configures the S6 per-project periodic intel collector.
type IntelConfig struct {
	Enabled bool          `yaml:"enabled"`
	Sources []IntelSource `yaml:"sources"`
}

// IntelSource is one pre-described source the collector scrapes on a schedule.
type IntelSource struct {
	Key         string `yaml:"key"`
	Project     string `yaml:"project"`
	Name        string `yaml:"name"`
	Instruction string `yaml:"instruction"`
	Cron        string `yaml:"cron"`
	Agent       string `yaml:"agent"`
}

// RadarConfig configures the S5 ecosystem radar (GitHub topic-search feed).
type RadarConfig struct {
	Enabled        bool          `yaml:"enabled"`
	PollInterval   time.Duration `yaml:"poll_interval"`
	MinStars       int           `yaml:"min_stars"`
	FreshnessDays  int           `yaml:"freshness_days"`
	Topics         []string      `yaml:"topics"`
	DigestEnabled  bool          `yaml:"digest_enabled"`
	DigestInterval time.Duration `yaml:"digest_interval"`
}

// ThreadsConfig настраивает синк «нитей идей» с GitHub (активен при
// непустом projects).
type ThreadsConfig struct {
	SyncInterval time.Duration `yaml:"sync_interval"` // 0 → 10m
}

func defaults() Config {
	return Config{
		Defaults: DefaultsConfig{
			Image:       "praktor-agent:latest",
			Model:       "claude-opus-4-7",
			MaxRunning:  5,
			IdleTimeout: 10 * time.Minute,
		},
		NATS: NATSConfig{
			DataDir: "data/nats",
		},
		Web: WebConfig{
			Enabled: true,
			Port:    8080,
		},
		Scheduler: SchedulerConfig{
			PollInterval: 30 * time.Second,
		},
		Speech: SpeechConfig{
			TTSMode:  "voice",
			TTSVoice: "alloy",
		},
	}
}

// Path returns the resolved config file path.
func Path() string {
	if v := os.Getenv("PRAKTOR_CONFIG"); v != "" {
		return v
	}
	return "config/praktor.yaml"
}

func Load() (*Config, error) {
	cfg := defaults()

	path := os.Getenv("PRAKTOR_CONFIG")
	if path == "" {
		path = "config/praktor.yaml"
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("read config: %w", err)
		}
		// Config file not found, use defaults + env
	} else {
		// Expand environment variables in YAML
		expanded := os.ExpandEnv(string(data))
		if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}
	}

	// Environment variable overrides
	applyEnv(&cfg)

	// Apply defaults for agent definitions
	for name, def := range cfg.Agents {
		if def.Workspace == "" {
			def.Workspace = name
			cfg.Agents[name] = def
		}
	}

	// Apply radar defaults (only when enabled)
	applyRadarDefaults(&cfg)
	applyIntelDefaults(&cfg)

	// Validation
	if err := validate(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// applyIntelDefaults fills per-source cron/agent fallbacks. Mirrors applyRadarDefaults.
func applyIntelDefaults(cfg *Config) {
	for i := range cfg.Intel.Sources {
		if cfg.Intel.Sources[i].Cron == "" {
			cfg.Intel.Sources[i].Cron = "0 9 * * 1" // weekly, Mon 09:00
		}
		if cfg.Intel.Sources[i].Agent == "" {
			cfg.Intel.Sources[i].Agent = cfg.Router.DefaultAgent
		}
	}
}

func applyRadarDefaults(cfg *Config) {
	if !cfg.Radar.Enabled {
		return
	}
	if cfg.Radar.PollInterval == 0 {
		cfg.Radar.PollInterval = 6 * time.Hour
	}
	if cfg.Radar.MinStars == 0 {
		cfg.Radar.MinStars = 10
	}
	if cfg.Radar.FreshnessDays == 0 {
		cfg.Radar.FreshnessDays = 30
	}
	if len(cfg.Radar.Topics) == 0 {
		cfg.Radar.Topics = []string{"mcp", "model-context-protocol", "claude-code"}
	}
	if cfg.Radar.DigestInterval == 0 {
		cfg.Radar.DigestInterval = 168 * time.Hour
	}
}

func validate(cfg *Config) error {
	if len(cfg.Agents) > 0 && cfg.Router.DefaultAgent == "" {
		return fmt.Errorf("router.default_agent is required when agents are defined")
	}
	if cfg.Router.DefaultAgent != "" {
		if _, ok := cfg.Agents[cfg.Router.DefaultAgent]; !ok {
			return fmt.Errorf("router.default_agent %q not found in agents map", cfg.Router.DefaultAgent)
		}
	}
	return nil
}

func applyEnv(cfg *Config) {
	if v := os.Getenv("PRAKTOR_TELEGRAM_TOKEN"); v != "" {
		cfg.Telegram.Token = v
	}
	if v := os.Getenv("ANTHROPIC_API_KEY"); v != "" {
		cfg.Defaults.AnthropicAPIKey = v
	}
	if v := os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"); v != "" {
		cfg.Defaults.OAuthToken = v
	}
	if v := os.Getenv("PRAKTOR_WEB_PASSWORD"); v != "" {
		cfg.Web.Auth = v
	}
	if v := os.Getenv("PRAKTOR_WEB_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Web.Port = port
		}
	}
	if v := os.Getenv("PRAKTOR_AGENT_MODEL"); v != "" {
		cfg.Defaults.Model = v
	}
	if v := os.Getenv("PRAKTOR_VAULT_PASSPHRASE"); v != "" {
		cfg.Vault.Passphrase = v
	}
	if v := os.Getenv("AGENTMAIL_API_KEY"); v != "" {
		cfg.AgentMail.APIKey = v
	}
	if v := os.Getenv("OPENAI_API_KEY"); v != "" {
		cfg.Speech.APIKey = v
	}
	if v := os.Getenv("INTAKE_TELEGRAM_TOKEN"); v != "" {
		cfg.Intake.TelegramToken = v
	}
}
