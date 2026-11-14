package models

import "github.com/ravenmk2/antcdp/internal/platform/httpx"

type Icon struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

func Icons() []Icon {
	return []Icon{{"deepseek", "DeepSeek"}, {"minimax", "MiniMax"}, {"glm", "GLM"}, {"ollama", "Ollama"}, {"openai", "OpenAI"}, {"claude", "Claude"}, {"qwen", "Qwen"}, {"gemini", "Gemini"}, {"model", "通用模型"}}
}
func validateIcon(key *string) error {
	if key == nil {
		return nil
	}
	for _, icon := range Icons() {
		if icon.Key == *key {
			return nil
		}
	}
	return httpx.Invalid("icon_key", "unsupported")
}
func DefaultBaseURL(kind string) string {
	return map[string]string{"deepseek": "https://api.deepseek.com", "minimax": "https://api.minimax.cn/v1", "glm": "https://open.bigmodel.cn/api/paas/v4", "ollama": "http://localhost:11434/v1"}[kind]
}
func DefaultIcon(kind string) string {
	if kind == "custom" {
		return "model"
	}
	return kind
}
