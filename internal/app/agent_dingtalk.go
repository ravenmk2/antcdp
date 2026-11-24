package app

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/papi"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/platform/resourcecode"
)

type agentDingTalk struct{ service *dingtalk.Service }

type dingTalkFailure struct{ observation agentcore.DispatchObservation }

func (f *dingTalkFailure) Error() string { return f.observation.Reason }

func robotPreparationError(err error) error {
	no := false
	var failure *httpx.Error
	if errors.As(err, &failure) {
		return &dingTalkFailure{toolObservation("failed", failure.Code, failure.Message, &no)}
	}
	if errors.Is(err, dingtalk.ErrAuthenticationUnavailable) {
		return &dingTalkFailure{toolFailure("ROBOT_AUTHENTICATION_UNAVAILABLE", &no)}
	}
	return &dingTalkFailure{toolFailure("DINGTALK_UNAVAILABLE", &no)}
}

func (d *agentDingTalk) list(ctx context.Context, x agentcore.ExecutionContext, _ agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
	args := struct {
		Query string `json:"query"`
		Page  int    `json:"page"`
		Size  int    `json:"page_size"`
	}{Page: 1, Size: 20}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, &papi.Failure{Code: papi.InvalidArguments}
	}
	page, err := d.service.AgentList(ctx, x.Authorization, args.Query, args.Page, args.Size)
	if err != nil {
		return nil, robotPreparationError(err)
	}
	return json.Marshal(page)
}

func (d *agentDingTalk) send(ctx context.Context, x agentcore.ExecutionContext, _ agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
	var args struct {
		Code string `json:"robot_code"`
		dingtalk.TestInput
	}
	if err := json.Unmarshal(raw, &args); err != nil || !resourcecode.Valid(args.Code) {
		return nil, &papi.Failure{Code: papi.InvalidArguments, Field: "/args/robot_code", Constraint: "resourceCode"}
	}
	result, err := d.service.AgentSend(ctx, x.Authorization, args.Code, args.TestInput)
	if err != nil {
		return nil, robotPreparationError(err)
	}
	return robotSendResult(args.Code, result.Status)
}

func robotSendResult(code, status string) (json.RawMessage, error) {
	switch status {
	case "accepted":
		return json.Marshal(map[string]string{"robot_code": code, "status": "accepted"})
	case "rejected":
		yes := true
		return nil, &dingTalkFailure{toolFailure("DINGTALK_REJECTED", &yes)}
	case "failed_before_submit":
		no := false
		return nil, &dingTalkFailure{toolFailure("SEND_NOT_SUBMITTED", &no)}
	default:
		return nil, &dingTalkFailure{toolObservation("outcome_unknown", "DINGTALK_RESULT_UNKNOWN", "钉钉消息可能已发出。请核实群内记录，勿自动重发。", nil)}
	}
}
