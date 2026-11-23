package mysql

import (
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"

	a "github.com/ravenmk2/antcdp/internal/modules/agents"
	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func init() {
	agentIntegrationCases = append(agentIntegrationCases, struct {
		Name string
		Run  func(*testing.T, *agentIntegrationFixture)
	}{"favorites_and_summary", agentFavoritesAndSummary})
}

func favoriteTestUser(t *testing.T, f *agentIntegrationFixture, username string) (*identity.User, string) {
	t.Helper()
	initial, password := "favorite-initial-password", "favorite-changed-password"
	user, _, err := f.Identity.CreateUser(f.Context, f.AdminToken, identity.CreateRequest{Username: username, DisplayName: username, Role: "user", Password: initial}, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	login, err := f.Identity.Login(f.Context, username, initial, "", identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Identity.ChangePassword(f.Context, login.Token, initial, password, identity.Metadata{}); err != nil {
		t.Fatal(err)
	}
	login, err = f.Identity.Login(f.Context, username, password, "", identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	return user, login.Token
}

func favoriteTestAgent(t *testing.T, f *agentIntegrationFixture) *a.Definition {
	t.Helper()
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	created, err := svc.CreateDefinition(ctx, raw, cryptox.ID(), a.DefinitionCreate{Code: cryptox.ID(), Name: "Favorite agent", Mode: "chat", ScopeKind: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	agent := created.Data.(*a.Definition)
	enableChatTestAgent(t, f, agent)
	return agent
}
func enableChatTestAgent(t *testing.T, f *agentIntegrationFixture, agent *a.Definition) {
	t.Helper()
	ctx, raw, svc := f.Context, f.AdminToken, f.Agents
	var modelID uint64
	if err := f.Store.db.GetContext(ctx, &modelID, "SELECT id FROM model_definition WHERE model_id='agent-test' LIMIT 1"); err != nil {
		t.Fatal(err)
	}
	bindings, err := svc.GetModelBindings(ctx, raw, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	id := strconv.FormatUint(modelID, 10)
	_, err = svc.PutModelBindings(ctx, raw, agent.ID, bindings.Tag, a.ModelBindingsWrite{Items: []a.ModelBindingWrite{{ModelID: id, GenerationParameters: json.RawMessage(`{}`)}}, DefaultModelID: id})
	if err != nil {
		t.Fatal(err)
	}
	current, err := svc.GetDefinition(ctx, raw, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.PatchDefinition(ctx, raw, agent.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: true}})
	if err != nil {
		t.Fatal(err)
	}
}

func agentFavoritesAndSummary(t *testing.T, f *agentIntegrationFixture) {
	ctx, svc, admin := f.Context, f.Agents, f.AdminToken
	user, raw := favoriteTestUser(t, f, "favorite_owner")
	_, other := favoriteTestUser(t, f, "favorite_other")
	agent := favoriteTestAgent(t, f)
	second := favoriteTestAgent(t, f)
	set := func(token string, id uint64, value bool) {
		t.Helper()
		result, err := svc.SetFavorite(ctx, token, id, value)
		if err != nil || result.Data.(a.FavoriteState) != (a.FavoriteState{AgentID: id, Favorited: value}) {
			t.Fatal("favorite mutation", result, err)
		}
	}
	list := func(token string, q a.Query) ([]a.CatalogAgent, int) {
		t.Helper()
		result, err := svc.ListFavorites(ctx, token, q)
		if err != nil {
			t.Fatal(err)
		}
		return result.Data.([]a.CatalogAgent), result.Pagination.Total
	}
	summary := func(token string, id uint64, name string, favorite bool) {
		t.Helper()
		result, err := svc.GetAgentSummary(ctx, token, id)
		if err != nil || result.Data.(a.AgentSummary) != (a.AgentSummary{ID: id, Name: name, Favorited: favorite}) {
			t.Fatal("navigation summary", result, err)
		}
	}

	set(raw, agent.ID, true)
	var original time.Time
	if err := f.Store.db.GetContext(ctx, &original, "SELECT created_at FROM agent_favorite WHERE user_id=? AND agent_id=?", user.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	errors := make(chan error, 6)
	for range 6 {
		group.Go(func() {
			_, err := svc.SetFavorite(ctx, raw, agent.ID, true)
			errors <- err
		})
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal("concurrent duplicate favorite", err)
		}
	}
	var stored time.Time
	if err := f.Store.db.GetContext(ctx, &stored, "SELECT created_at FROM agent_favorite WHERE user_id=? AND agent_id=?", user.ID, agent.ID); err != nil || !stored.Equal(original) {
		t.Fatal("duplicate favorite changed order", stored, original, err)
	}
	set(raw, second.ID, true)
	rows, total := list(raw, a.Query{PageSize: 1})
	if total != 2 || len(rows) != 1 || rows[0].ID != second.ID || !rows[0].Favorited {
		t.Fatal("favorite order/page", rows, total)
	}
	rows, total = list(raw, a.Query{Page: 2, PageSize: 1})
	if total != 2 || len(rows) != 1 || rows[0].ID != agent.ID {
		t.Fatal("favorite second page", rows, total)
	}
	if rows, total = list(other, a.Query{}); total != 0 || len(rows) != 0 {
		t.Fatal("favorites leaked between users", rows, total)
	}
	summary(raw, agent.ID, agent.Name, true)
	summary(other, agent.ID, agent.Name, false)
	set(other, agent.ID, false)
	summary(raw, agent.ID, agent.Name, true)

	for _, token := range []string{raw, other} {
		catalog, err := svc.GetCatalog(ctx, token, agent.ID)
		if err != nil || catalog.Data.(a.CatalogAgent).Favorited != (token == raw) {
			t.Fatal("catalog detail preference", catalog, err)
		}
		catalog, err = svc.ListCatalog(ctx, token, a.Query{PageSize: 100})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range catalog.Data.([]a.CatalogAgent) {
			if item.ID == agent.ID {
				found = true
				if item.Favorited != (token == raw) {
					t.Fatal("catalog list preference", item)
				}
			}
		}
		if !found {
			t.Fatal("available agent missing from catalog")
		}
	}

	current, err := svc.GetDefinition(ctx, admin, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.PatchDefinition(ctx, admin, second.ID, current.Tag, a.DefinitionPatch{Enabled: a.Field[bool]{Set: true, Value: false}, Name: a.Field[string]{Set: true, Value: "Favorite 100%_ renamed"}})
	if err != nil {
		t.Fatal(err)
	}
	summary(raw, second.ID, "Favorite 100%_ renamed", true)
	rows, total = list(raw, a.Query{Q: "100%_"})
	if total != 1 || len(rows) != 1 || rows[0].ID != second.ID || rows[0].Availability.Available {
		t.Fatal("disabled favorite/search", rows, total)
	}
	set(raw, second.ID, false)
	set(raw, second.ID, false)
	set(raw, second.ID, true)
	_, err = svc.GetCatalog(ctx, raw, second.ID)
	modelsExpectCode(t, err, "NOT_FOUND")

	// A missing model binding must not hide navigation identity or the saved favorite.
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE agent SET default_model_binding_id=NULL WHERE id=?", agent.ID); err != nil {
		t.Fatal(err)
	}
	summary(raw, agent.ID, agent.Name, true)
	rows, total = list(raw, a.Query{})
	if total != 2 || rows[1].Availability.Available {
		t.Fatal("unavailable favorite disappeared", rows, total)
	}

	service, err := svc.CreateDefinition(ctx, admin, cryptox.ID(), a.DefinitionCreate{Code: cryptox.ID(), Name: "Favorite service", Mode: "service", RobotUserID: new(fmt.Sprint(createTestRobot(t, f).ID)), ScopeKind: "platform"})
	if err != nil {
		t.Fatal(err)
	}
	serviceID := service.Data.(*a.Definition).ID
	_, err = svc.SetFavorite(ctx, admin, serviceID, true)
	modelsExpectCode(t, err, "NOT_FOUND")
	_, err = svc.GetAgentSummary(ctx, raw, serviceID)
	modelsExpectCode(t, err, "NOT_FOUND")
	summary(admin, serviceID, "Favorite service", false)
	_, err = svc.GetAgentSummary(ctx, raw, ^uint64(0))
	modelsExpectCode(t, err, "NOT_FOUND")
	_, err = svc.SetFavorite(ctx, raw, ^uint64(0), true)
	modelsExpectCode(t, err, "NOT_FOUND")
	set(raw, ^uint64(0), false)

	agentFavoriteHistoryAccess(t, f, user, raw, other)
}

func agentFavoriteHistoryAccess(t *testing.T, f *agentIntegrationFixture, user *identity.User, raw, other string) {
	t.Helper()
	ctx, svc, admin := f.Context, f.Agents, f.AdminToken
	agent := favoriteTestAgent(t, f)
	created, err := svc.CreateSession(ctx, raw, cryptox.ID(), a.SessionCreate{AgentID: strconv.FormatUint(agent.ID, 10)})
	if err != nil {
		t.Fatal(err)
	}
	session := created.Data.(a.SessionDetail)
	if _, err = svc.SetFavorite(ctx, raw, agent.ID, true); err != nil {
		t.Fatal(err)
	}
	// Give only the other user a current scope grant. The owner keeps historical read access.
	auth, err := f.Identity.Current(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	collab := &collaboration.Service{Identity: f.Identity}
	team, _, err := collab.Create(ctx, admin, collaboration.Team, collaboration.Write{Code: "favorite-history", Name: new("Favorite history"), Admins: []string{strconv.FormatUint(auth.User.ID, 10)}}, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Store.db.ExecContext(ctx, "UPDATE agent SET scope_kind='team',scope_id=? WHERE id=?", team.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	result, err := svc.GetAgentSummary(ctx, raw, agent.ID)
	if err != nil || result.Data.(a.AgentSummary).Name != agent.Name {
		t.Fatal("history did not grant minimum summary", result, err)
	}
	_, err = svc.SetFavorite(ctx, raw, agent.ID, true)
	modelsExpectCode(t, err, "NOT_FOUND")
	result, err = svc.ListFavorites(ctx, raw, a.Query{PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Data.([]a.CatalogAgent) {
		if item.ID == agent.ID {
			t.Fatal("revoked favorite still exposed")
		}
	}
	if _, err = svc.SetFavorite(ctx, raw, agent.ID, false); err != nil {
		t.Fatal("revoked favorite cleanup", err)
	}
	if _, err = svc.SetFavorite(ctx, other, agent.ID, true); err != nil {
		t.Fatal("current scope member cannot favorite", err)
	}
	current, err := svc.GetDefinition(ctx, admin, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.DeleteDefinition(ctx, admin, agent.ID, current.Tag, cryptox.ID()); err != nil {
		t.Fatal(err)
	}
	result, err = svc.GetAgentSummary(ctx, raw, agent.ID)
	if err != nil || result.Data.(a.AgentSummary).Favorited {
		t.Fatal("deleted agent history summary", result, err)
	}
	if _, err = svc.GetSession(ctx, raw, session.Configuration.ID); err != nil {
		t.Fatal("historical session no longer readable", err)
	}
	for _, token := range []string{other, admin} {
		_, err = svc.GetAgentSummary(ctx, token, agent.ID)
		modelsExpectCode(t, err, "NOT_FOUND")
	}
	result, err = svc.ListFavorites(ctx, other, a.Query{})
	if err != nil || result.Pagination.Total != 0 || len(result.Data.([]a.CatalogAgent)) != 0 {
		t.Fatal("deleted favorite still exposed", result, err)
	}
	if _, err = svc.SetFavorite(ctx, other, agent.ID, false); err != nil {
		t.Fatal("deleted favorite cleanup", err)
	}
	var count int
	if err = f.Store.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM agent_session WHERE agent_id=? AND executor_user_id=?", agent.ID, user.ID); err != nil || count != 1 {
		t.Fatal("favorite operations changed history", count, err)
	}
}
