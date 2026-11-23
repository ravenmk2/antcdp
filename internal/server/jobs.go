package server

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/jobs"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

type jobIDs struct{ Project, Job, Run, Schedule uint64 }

func jobRoute(o Options, status int, fn func(*gin.Context, jobIDs) (any, *identity.Auth, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		var ids jobIDs
		for key, dst := range map[string]*uint64{"id": &ids.Project, "jobID": &ids.Job, "runID": &ids.Run, "scheduleID": &ids.Schedule} {
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
		if c.IsAborted() {
			return
		}
		if !collaborationFinish(c, o, a, err) {
			return
		}
		httpx.Data(c, status, out)
	}
}
func jobPage(c *gin.Context, key string) (uint64, error) {
	raw := c.Query(key)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, httpx.Invalid(key, "invalid")
	}
	return n, nil
}
func registerJobs(api *gin.RouterGroup, o Options) {
	s := o.Jobs
	if s == nil {
		return
	}
	base := "/projects/:id/jobs"
	api.GET(base, jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		before, err := jobPage(c, "before")
		if err != nil {
			return nil, nil, err
		}
		status := c.Query("status")
		if status != "" && status != "enabled" && status != "disabled" {
			return nil, nil, httpx.Invalid("status", "invalid")
		}
		items, a, err := s.List(c.Request.Context(), rawSession(c), id.Project, jobs.Filter{Before: before, Query: c.Query("q"), Status: status})
		return gin.H{"items": items}, a, err
	}))
	for _, create := range []bool{true, false} {
		path, method := base, "POST"
		if !create {
			path += "/:jobID"
			method = "PUT"
		}
		api.Handle(method, path, jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
			var w jobs.Write
			if !httpx.Decode(c, &w) {
				return nil, nil, nil
			}
			return s.Save(c.Request.Context(), rawSession(c), id.Project, id.Job, w)
		}))
	}
	api.GET(base+"/:jobID", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		return s.Get(c.Request.Context(), rawSession(c), id.Project, id.Job)
	}))
	for _, debug := range []bool{false, true} {
		path := "/runs"
		if debug {
			path = "/debug"
		}
		api.POST(base+"/:jobID"+path, jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
			var w jobs.Start
			if !httpx.Decode(c, &w) {
				return nil, nil, nil
			}
			return s.Start(c.Request.Context(), rawSession(c), id.Project, id.Job, w, debug)
		}))
	}
	api.GET(base+"/:jobID/runs", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		before, err := jobPage(c, "before")
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.History(c.Request.Context(), rawSession(c), id.Project, id.Job, before)
		return gin.H{"items": items}, a, err
	}))
	api.GET(base+"/:jobID/runs/:runID", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		after, err := jobPage(c, "after_seq")
		if err != nil {
			return nil, nil, err
		}
		return s.Observe(c.Request.Context(), rawSession(c), id.Project, id.Job, id.Run, after)
	}))
	api.POST(base+"/:jobID/runs/:runID/cancel", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		return s.Cancel(c.Request.Context(), rawSession(c), id.Project, id.Job, id.Run)
	}))
	api.GET(base+"/:jobID/triggers", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		before, err := jobPage(c, "before")
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.Receipts(c.Request.Context(), rawSession(c), id.Project, id.Job, before)
		return gin.H{"items": items}, a, err
	}))
	api.GET(base+"/:jobID/schedules", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		items, a, err := s.Schedules(c.Request.Context(), rawSession(c), id.Project, id.Job)
		return gin.H{"items": items}, a, err
	}))
	for _, create := range []bool{true, false} {
		path, method := base+"/:jobID/schedules", "POST"
		if !create {
			path += "/:scheduleID"
			method = "PUT"
		}
		api.Handle(method, path, jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
			var w jobs.Schedule
			if !httpx.Decode(c, &w) {
				return nil, nil, nil
			}
			return s.SaveSchedule(c.Request.Context(), rawSession(c), id.Project, id.Job, id.Schedule, w)
		}))
	}
	api.GET(base+"/:jobID/schedules/:scheduleID/fires", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		before, err := jobPage(c, "before")
		if err != nil {
			return nil, nil, err
		}
		items, a, err := s.Fires(c.Request.Context(), rawSession(c), id.Project, id.Job, id.Schedule, before)
		return gin.H{"items": items}, a, err
	}))
	api.POST(base+"/:jobID/schedule-preview", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		_, a, err := s.Get(c.Request.Context(), rawSession(c), id.Project, id.Job)
		if err != nil {
			return nil, a, err
		}
		var w struct {
			Cron     string `json:"cron"`
			Timezone string `json:"timezone"`
		}
		if !httpx.Decode(c, &w) {
			return nil, a, nil
		}
		times, err := jobs.Preview(w.Cron, w.Timezone)
		return gin.H{"times": times}, a, err
	}))
	api.POST(base+"/:jobID/clear-debug-state", jobRoute(o, 200, func(c *gin.Context, id jobIDs) (any, *identity.Auth, error) {
		a, err := s.ClearDebug(c.Request.Context(), rawSession(c), id.Project, id.Job)
		return gin.H{"cleared": err == nil}, a, err
	}))
}
