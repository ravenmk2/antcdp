package agentcore

import (
	"encoding/json"
)

// HistoryGroup is indivisible on the HTTP/snapshot boundary. Hosts group an
// assistant declaration with its same-transaction tool/call intents. Subsequent
// tool results and human inputs are separate observation groups. This does not
// relax the complete assistant/result pairing required by the model surface.
type HistoryGroup struct{ Records []Event }
type HistorySelection struct {
	Records []Event
	Before  *Seq
	HasMore bool
}

func SelectHistory(groups []HistoryGroup, through Seq, before *Seq, maxRecords, maxBytes int) (HistorySelection, error) {
	if maxRecords < 1 || maxRecords > 1000 || maxBytes < 2 || maxBytes > MaxHistoryBytes {
		return HistorySelection{}, invalid("history_limit")
	}
	cut := through + 1
	if through == ^Seq(0) {
		return HistorySelection{}, invalid("through_seq")
	}
	if before != nil {
		if *before == 0 || *before > cut {
			return HistorySelection{}, invalid("before_seq")
		}
		cut = *before
	}
	selected := HistorySelection{Records: []Event{}}
	last := Seq(0)
	eligible := []HistoryGroup{}
	for _, group := range groups {
		if len(group.Records) == 0 {
			return selected, reject("HISTORY_GROUP_INVALID")
		}
		for _, record := range group.Records {
			if record.Seq <= last {
				return selected, reject("HISTORY_GROUP_INVALID")
			}
			last = record.Seq
		}
		first, end := group.Records[0].Seq, group.Records[len(group.Records)-1].Seq
		if first < cut && end >= cut {
			return selected, reject("HISTORY_GROUP_BOUNDARY")
		}
		if end < cut && end <= through {
			eligible = append(eligible, group)
		}
	}
	for n := len(eligible) - 1; n >= 0; n-- {
		candidate := append(append([]Event{}, eligible[n].Records...), selected.Records...)
		raw, err := json.Marshal(candidate)
		if err != nil {
			return selected, err
		}
		if len(raw) > maxBytes || len(candidate) > maxRecords && len(selected.Records) > 0 {
			selected.HasMore = true
			break
		}
		if len(raw) > MaxHistoryBytes {
			return selected, reject("HISTORY_GROUP_TOO_LARGE")
		}
		selected.Records = candidate
	}
	if selected.HasMore {
		cursor := cut
		if len(selected.Records) > 0 {
			cursor = selected.Records[0].Seq
		}
		selected.Before = &cursor
	}
	return selected, nil
}

// TrimSnapshotHistory uses the actual final frame encoder, including envelope,
// state and transient draft. It drops complete OLDEST groups only, and can
// return zero records with before_seq=through_seq+1 for HTTP backfill.
func TrimSnapshotHistory(groups []HistoryGroup, through Seq, encode func(HistorySelection) ([]byte, error)) (HistorySelection, error) {
	if encode == nil || through == ^Seq(0) {
		return HistorySelection{}, invalid("snapshot")
	}
	for drop := 0; drop <= len(groups); drop++ {
		selection := HistorySelection{Records: []Event{}, HasMore: drop > 0}
		for _, group := range groups[drop:] {
			selection.Records = append(selection.Records, group.Records...)
		}
		if selection.HasMore {
			before := through + 1
			if len(selection.Records) > 0 {
				before = selection.Records[0].Seq
			}
			selection.Before = &before
		}
		frame, err := encode(selection)
		if err != nil {
			return selection, err
		}
		history, err := json.Marshal(selection.Records)
		if err != nil {
			return selection, err
		}
		if len(frame) <= 2<<20 && len(history) <= MaxHistoryBytes {
			return selection, nil
		}
	}
	return HistorySelection{}, reject("SNAPSHOT_TOO_LARGE")
}
