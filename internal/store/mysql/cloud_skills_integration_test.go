package mysql

import (
	"bytes"
	"strconv"
	"strings"
	"testing"
	"time"

	core "github.com/ravenmk2/antcdp/internal/agentcore"
	r "github.com/ravenmk2/antcdp/internal/modules/agentresources"
	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func cloudSkillBindingsIntegration(t *testing.T, f *agentIntegrationFixture, cloud *a.CloudService, remote *sandboxMemoryProvider) {
	ctx, host, raw := f.Context, f.Agents, f.AdminToken
	resources := &r.Service{Identity: f.Identity, Store: host.Store, ETag: host.ETag, Files: host.Files, Epoch: host.Epoch}
	oldSkill, oldSource, oldFactory := host.Catalog.Skill, host.Skills, cloud.Factory
	t.Cleanup(func() { host.Catalog.Skill, host.Skills, cloud.Factory = oldSkill, oldSource, oldFactory })
	host.Catalog.Skill = resources.ReadSkillSnapshot
	host.Skills = a.FrozenSkillSource{Host: host}
	environment := &environmentMemoryProvider{sandboxMemoryProvider: remote, executions: map[string]sb.ExecResult{}, outputs: map[string]string{}, files: map[string][]byte{}, transfers: map[string][]byte{}}
	cloud.Factory = environmentMemoryFactory{environment}
	created, err := resources.CreateSkill(ctx, raw, cryptox.ID(), r.SkillCreate{Name: "cloud-review", Title: "Cloud review"})
	if err != nil {
		t.Fatal(err)
	}
	skill := created.Data.(*r.Skill)
	publish := func(label string) *r.SkillVersion {
		t.Helper()
		upload, err := resources.UploadSkill(ctx, raw, cryptox.ID(), "review.zip", strconv.FormatUint(skill.ID, 10), bytes.NewReader(skillFixtureArchive(t, skill.Name)))
		if err != nil {
			t.Fatal(err)
		}
		if err = resources.ProcessSkills(ctx, 4); err != nil {
			t.Fatal(err)
		}
		current, err := resources.GetSkill(ctx, raw, skill.ID)
		if err != nil {
			t.Fatal(err)
		}
		version, err := resources.PublishSkill(ctx, raw, skill.ID, current.Tag, cryptox.ID(), r.SkillPublish{UploadID: strconv.FormatUint(*upload.OperationID, 10), Label: label})
		if err != nil {
			t.Fatal(err)
		}
		return version.Data.(*r.SkillVersion)
	}
	firstVersion, secondVersion := publish("one"), publish("two")
	agent := runtimeTestAgent(t, f)
	bind := func(version uint64) {
		t.Helper()
		current, err := host.GetSkillBindings(ctx, raw, agent.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = host.PutSkillBindings(ctx, raw, agent.ID, current.Tag, a.SkillBindingsWrite{Items: []a.SkillBindingWrite{{SkillID: strconv.FormatUint(skill.ID, 10), VersionID: strconv.FormatUint(version, 10), Enabled: true}}})
		if err != nil {
			t.Fatal(err)
		}
	}
	finish := func(x core.ExecutionContext) {
		t.Helper()
		if _, err := host.EndRoot(ctx, x.Ref, core.RunEnd{Status: core.Succeeded}); err != nil {
			t.Fatal(err)
		}
		if err := cloud.ProcessPending(ctx, 50); err != nil {
			t.Fatal(err)
		}
		if _, err := host.ConvergeDue(ctx, time.Now().UTC(), 100); err != nil {
			t.Fatal(err)
		}
	}
	bind(firstVersion.ID)
	first := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "read pinned skill")
	if err = cloud.PrepareTurn(ctx, first); err != nil {
		t.Fatal("materialize first set", err)
	}
	loaded, err := host.Skills.Load(ctx, first, skill.Name, "SKILL.md")
	if err != nil || uint64(loaded.VersionID) != firstVersion.ID || !loaded.Materialized || !strings.HasSuffix(loaded.StablePath, "/skills/cloud-review") {
		t.Fatal("load pinned skill", err)
	}
	second := runtimeClaim(t, f, runtimeSession(t, f, agent.ID).Configuration.ID, "same pinned version")
	launches := environment.launches
	if err = cloud.PrepareTurn(ctx, second); err != nil || launches != environment.launches {
		t.Fatal("same version unnecessarily replaced the shared directory", err)
	}
	bind(secondVersion.ID)
	queued := runtimeSession(t, f, agent.ID)
	accepted, err := host.SubmitInput(ctx, raw, queued.Configuration.ID, cryptox.ID(), a.InputCreate{Content: []core.TextBlock{{Type: "text", Text: "new version"}}, ExpectedHash: queued.Selection.Hash})
	if err != nil {
		t.Fatal(err)
	}
	request := core.ClaimRequest{Candidate: core.Candidate{SessionID: core.ID(queued.Configuration.ID), InputID: core.ID(accepted.Data.(a.InputAccepted).InputID)}, Epoch: host.Epoch}
	claim, err := host.ClaimRoot(ctx, request)
	if err != nil || claim.Claimed {
		t.Fatal("changed skill version must wait for old leases", err)
	}
	current, err := resources.GetSkillVersion(ctx, raw, skill.ID, firstVersion.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = resources.DeleteSkillVersion(ctx, raw, skill.ID, firstVersion.ID, current.Tag, cryptox.ID())
	modelsExpectCode(t, err, "RESOURCE_IN_USE")
	finish(first)
	finish(second)
	_, err = resources.DeleteSkillVersion(ctx, raw, skill.ID, firstVersion.ID, current.Tag, cryptox.ID())
	if err != nil {
		t.Fatal("settled root did not release old version pin", err)
	}
	claim, err = host.ClaimRoot(ctx, request)
	if err != nil || !claim.Claimed {
		t.Fatal("new skill version not admitted after old leases ended", err)
	}
	if err = cloud.PrepareTurn(ctx, claim.Execution); err != nil {
		t.Fatal("materialize replacement", err)
	}
	current, err = resources.GetSkill(ctx, raw, skill.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = resources.PatchSkill(ctx, raw, skill.ID, current.Tag, r.SkillPatch{Enabled: r.Field[bool]{Set: true, Value: false}}); err != nil {
		t.Fatal(err)
	}
	loaded, err = host.Skills.Load(ctx, claim.Execution, skill.Name, "SKILL.md")
	if err != nil || uint64(loaded.VersionID) != secondVersion.ID {
		t.Fatal("catalog disablement changed in-flight skill authority", err)
	}
	finish(claim.Execution)
}
