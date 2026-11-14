package agentcore

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestQuestionRecommendationsPersistAndValidate(t *testing.T) {
	questions := []Question{{ID: "scope", Prompt: "Choose scope", Type: "single_choice", Options: []QuestionOption{
		{ID: "one", Label: "One", Recommended: pointer(true)},
		{ID: "two", Label: "Two", Recommended: pointer(false)},
		{ID: "legacy", Label: "Legacy"},
	}}}
	encoded, err := json.Marshal(questions)
	if err != nil {
		t.Fatal(err)
	}
	var restored []Question
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(questions, restored) {
		t.Fatal("JSON round trip must preserve explicit false and absent recommendations")
	}
	if err := ValidateQuestions(restored); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAnswer(restored, QuestionAnswer{Answers: []AnswerItem{{QuestionID: "scope", OptionIDs: []string{"two"}}}}); err != nil {
		t.Fatalf("a non-recommended answer must remain valid: %v", err)
	}
	restored[0].Options[1].Recommended = pointer(true)
	if ValidateQuestions(restored) == nil {
		t.Fatal("single choice accepted multiple recommendations")
	}
	restored[0].Type = "multi_choice"
	if err := ValidateQuestions(restored); err != nil {
		t.Fatalf("multiple choice rejected multiple recommendations: %v", err)
	}
}

func TestTimelyAnswerResumesToolWithoutQueuedInput(t *testing.T) {
	now := time.Now()
	session := Session{ID: 1, ActiveRunID: pointer(ID(2))}
	question := Interaction{ID: 3, SessionID: 1, RunID: 2, Kind: "question", Status: "waiting", Version: 1, Deadline: now.Add(time.Minute), Questions: []Question{{ID: "q", Prompt: "Details?", Type: "text"}}}
	answer := QuestionAnswer{Answers: []AnswerItem{{QuestionID: "q", Text: pointer("answer")}}}
	plan, err := PlanAnswer(session, question, 1, ActorRef{}, answer, 0, now)
	if err != nil || plan.Delivery != "tool_result" || !plan.SettleTool || plan.Interaction.Status != "answered" || plan.Interaction.PendingReplyInputID != nil {
		t.Fatalf("timely answer queued instead of resuming: %+v %v", plan, err)
	}
	_, err = PlanAnswer(session, plan.Interaction, 2, ActorRef{}, answer, 0, now)
	code(t, err, "INTERACTION_ALREADY_ANSWERED")
}

func TestTimedOutQuestionSurvivesNormalTurnEnd(t *testing.T) {
	session := Session{ID: 1, ActiveRunID: pointer(ID(2))}
	run := Run{Ref: ExecutionRef{SessionID: 1, RunID: 2}, Status: Running}
	for _, status := range []string{"continued", "reply_queued"} {
		question := Interaction{ID: 3, SessionID: 1, RunID: 2, Kind: "question", Status: status, Version: 1}
		plan, err := PlanEnd(session, run, RunEnd{Status: Succeeded}, nil, []Interaction{question})
		if err != nil || plan.Interactions[0].Status != status {
			t.Fatalf("normal turn end closed late reply: %+v %v", plan, err)
		}
		plan, err = PlanEnd(session, run, RunEnd{Status: Cancelled}, nil, []Interaction{question})
		if err != nil || plan.Interactions[0].Status != "cancelled" {
			t.Fatalf("stop left question open: %+v %v", plan, err)
		}
	}
}
