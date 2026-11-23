package server

import (
	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/events"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type eventIDs struct{ Project, Event, Subscription, Consumption, Revision uint64 }

func eventRoute(o Options, fn func(*gin.Context, eventIDs) (any, *identity.Auth, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		var ids eventIDs
		for key, dst := range map[string]*uint64{"id": &ids.Project, "eventID": &ids.Event, "subscriptionID": &ids.Subscription, "consumptionID": &ids.Consumption, "revisionID": &ids.Revision} {
			if c.Param(key) == "" {
				continue
			}
			v, ok := collaborationID(c, key)
			if !ok {
				return
			}
			*dst = v
		}
		out, a, err := fn(c, ids)
		if c.IsAborted() || !collaborationFinish(c, o, a, err) {
			return
		}
		httpx.Data(c, 200, out)
	}
}
func eventFilter(c *gin.Context) (events.Filter, error) {
	before, err := jobPage(c, "before")
	if err != nil {
		return events.Filter{}, err
	}
	sub, err := jobPage(c, "subscription_id")
	return events.Filter{Before: before, SubscriptionID: sub, Type: c.Query("type"), Status: c.Query("status")}, err
}
func registerEvents(api *gin.RouterGroup, o Options) {
	s := o.Events
	if s == nil {
		return
	}
	api.GET("/event-types", eventRoute(o, func(c *gin.Context, _ eventIDs) (any, *identity.Auth, error) {
		a, err := o.Identity.BusinessAccess(c.Request.Context(), rawSession(c), nil, func(identity.Tx, *identity.Auth) error { return nil })
		return gin.H{"groups": events.Catalog()}, a, err
	}))
	base := "/projects/:id"
	api.GET(base+"/events", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		f, err := eventFilter(c)
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.Events(c.Request.Context(), rawSession(c), id.Project, f)
		return gin.H{"items": items}, a, err
	}))
	api.GET(base+"/events/:eventID", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Event(c.Request.Context(), rawSession(c), id.Project, id.Event)
	}))
	base += "/event-subscriptions"
	api.GET(base, eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		items, a, err := s.Subscriptions(c.Request.Context(), rawSession(c), id.Project)
		return gin.H{"items": items}, a, err
	}))
	for _, create := range []bool{true, false} {
		path, method := base, "POST"
		if !create {
			path += "/:subscriptionID"
			method = "PUT"
		}
		api.Handle(method, path, eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
			var w events.Write
			if !httpx.Decode(c, &w) {
				return nil, nil, nil
			}
			return s.Save(c.Request.Context(), rawSession(c), id.Project, id.Subscription, w)
		}))
	}
	api.GET(base+"/:subscriptionID", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Subscription(c.Request.Context(), rawSession(c), id.Project, id.Subscription)
	}))
	api.PUT(base+"/:subscriptionID/enabled", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		var w struct {
			Version string `json:"version"`
			Enabled bool   `json:"enabled"`
		}
		if !httpx.Decode(c, &w) {
			return nil, nil, nil
		}
		return s.SetEnabled(c.Request.Context(), rawSession(c), id.Project, id.Subscription, w.Version, w.Enabled)
	}))
	api.DELETE(base+"/:subscriptionID", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		var w struct {
			Version string `json:"version"`
		}
		if !httpx.Decode(c, &w) {
			return nil, nil, nil
		}
		a, err := s.Delete(c.Request.Context(), rawSession(c), id.Project, id.Subscription, w.Version)
		return gin.H{"deleted": true}, a, err
	}))
	api.GET(base+"/:subscriptionID/source", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Source(c.Request.Context(), rawSession(c), id.Project, id.Subscription, 0)
	}))
	api.GET(base+"/:subscriptionID/revisions", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		items, a, err := s.Revisions(c.Request.Context(), rawSession(c), id.Project, id.Subscription)
		return gin.H{"items": items}, a, err
	}))
	api.GET(base+"/:subscriptionID/revisions/:revisionID/source", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Source(c.Request.Context(), rawSession(c), id.Project, id.Subscription, id.Revision)
	}))
	base = "/projects/:id/event-consumptions"
	api.GET(base, eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		f, err := eventFilter(c)
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.Consumptions(c.Request.Context(), rawSession(c), id.Project, f)
		return gin.H{"items": items}, a, err
	}))
	api.GET(base+"/:consumptionID", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Consumption(c.Request.Context(), rawSession(c), id.Project, id.Consumption)
	}))
	api.GET(base+"/:consumptionID/logs", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		after, err := jobPage(c, "after_seq")
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.Logs(c.Request.Context(), rawSession(c), id.Project, id.Consumption, after)
		return gin.H{"items": items}, a, err
	}))
	api.POST(base+"/:consumptionID/retry", eventRoute(o, func(c *gin.Context, id eventIDs) (any, *identity.Auth, error) {
		return s.Retry(c.Request.Context(), rawSession(c), id.Project, id.Consumption)
	}))
}
